/* eslint no-console: off */

/**
 * Android SDK first-run fetch -- main-process half.
 *
 * Fetch-not-bundle, per DECISIONS.md 2026-08-27: the SDK is NOT in the
 * installer. Fabrica never redistributes anything Google owns (Android SDK
 * Terms 3.3/3.4); the JDK (Temurin 17) and Gradle ARE bundled because they are
 * license-clean, and only the SDK itself -- including `adb.exe` -- is fetched.
 * That decision is closed; this module implements it, it does not revisit it.
 *
 * SCOPE, and this is worth saying plainly because it is easy to assume
 * otherwise: this fetch gates APK BUILDING ONLY. Device mirroring has zero
 * dependency on it -- ws-scrcpy speaks the ADB wire protocol directly through
 * `@dead50f7/adbkit` and never spawns `adb.exe` (DECISIONS.md 2026-08-28,
 * verified against the built server source). A student who never runs this
 * flow can still mirror a phone. Nothing here may ever block the rest of the
 * IDE.
 *
 * Structured to match `mirrorProcess.ts` deliberately -- module-level
 * lifecycle state, exported async entry points, `app.isPackaged` path
 * branching, progress relayed to the renderer over IPC, and an
 * `app.on('before-quit')` teardown -- so `src/main/` stays one mental model
 * rather than two. The one intentional divergence: no `utilityProcess.fork()`.
 * There is no long-lived server to own here, only child processes that run and
 * exit, so a fork would add a lifecycle without buying one.
 */
import { spawn, ChildProcess } from 'child_process';
import dns from 'dns';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { app, BrowserWindow, ipcMain } from 'electron';

// ---------------------------------------------------------------------------
// Pinned toolchain.
//
// Every version here is the one that was validated end-to-end on 2026-08-27,
// NOT "latest". A student installing in six months must get the toolchain that
// was actually tested -- `sdkmanager` will happily hand out a newer one and
// leave the failure to surface mid-build.

/**
 * The Windows command-line tools archive, PINNED to a specific build.
 *
 * The URL keys off Google's opaque BUILD NUMBER (15859902), not the version
 * string DECISIONS.md records (cmdline-tools `latest` channel, v23.0) -- the
 * mapping between the two is published only on the Android Studio download
 * page and cannot be derived. Confirmed by Andre from
 * https://developer.android.com/studio ("Command line tools only" row) on
 * 2026-09-09.
 *
 * Do NOT replace this with a "fetch whatever is current" scheme. The pin is the
 * point: a student installing in six months must get the toolchain that was
 * actually validated, not one Google rotated in afterwards. Bumping it means
 * re-running the end-to-end APK build first.
 */
const CMDLINE_TOOLS_URL =
  'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip';

/**
 * Guard against shipping an unconfirmed pin. Set to false again alongside any
 * future URL change, and only back to true once the new build has actually
 * produced a working APK -- `verifyToolsUrlPinned()` fails the fetch loudly
 * while this is false, which is much cheaper than silently installing a
 * toolchain nobody validated and discovering it mid-build.
 */
const CMDLINE_TOOLS_URL_VERIFIED = true;

/**
 * The exact package list, corrected against what a real APK build actually
 * pulled (DECISIONS.md 2026-08-27). Installing these explicitly IS the point of
 * the flow: if they are missing, a student's first build silently downloads
 * ~2.5GB mid-session, which is precisely the failure this exists to prevent.
 *
 * `build-tools;36.0.0` is deliberate and must not be "upgraded" to 36.1.0 --
 * AGP wants 36.0.0 and will fetch it itself, making 36.1.0 wasted bytes. The
 * NDK is mandatory and was proven so by removing it (the requirement lives in
 * the Flutter Gradle plugin, not the app template); ~2.5GB of the footprint is
 * unavoidable and this is closed, not a disk-savings opportunity.
 */
const SDK_PACKAGES = [
  'platform-tools',
  'platforms;android-36',
  'build-tools;36.0.0',
  'ndk;28.2.13676358',
  'cmake;3.22.1',
  'cmdline-tools;latest',
] as const;

/**
 * Measured, not estimated: ~3.7GB first-run download, ~5.6GB on disk after the
 * first build. The preflight check below uses the disk figure plus a margin,
 * because failing at 90% of a 3.7GB download on a full disk is the single most
 * expensive way for this to go wrong.
 */
const REQUIRED_FREE_BYTES = 7 * 1024 * 1024 * 1024;

// Google's CDN is the reachability probe target rather than a generic host: it
// is what actually has to be reachable, and a captive portal that resolves
// example.com while blocking dl.google.com is a real lab-network shape.
const CONNECTIVITY_PROBE_HOST = 'dl.google.com';

const DOWNLOAD_STALL_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 5;

// ---------------------------------------------------------------------------
// Paths.

/**
 * `%LOCALAPPDATA%\Fabrica\android-sdk`, per DECISIONS.md 2026-08-27 -- the path
 * the toolchain was validated at, so the layout being shipped is the layout
 * that was tested.
 *
 * Deliberately NOT `app.getPath('userData')`, which is the pattern the rest of
 * the app uses (recent-projects.json, stats) and which resolves to
 * %APPDATA%\Fabrica -- the ROAMING profile. A multi-gigabyte SDK in a roaming
 * profile is a genuine problem on the domain-joined lab machines this ships to:
 * the profile is copied on login/logout. Local is correct for a rebuildable
 * cache, and this is the one place where following the app's usual userData
 * convention would be the wrong call.
 *
 * The userData fallback exists only for a non-Windows dev box, where
 * LOCALAPPDATA is undefined.
 */
export const getFabricaDataRoot = (): string => {
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    return path.join(localAppData, 'Fabrica');
  }

  return app.getPath('userData');
};

export const getAndroidSdkRoot = (): string =>
  path.join(getFabricaDataRoot(), 'android-sdk');

/**
 * `%LOCALAPPDATA%\Fabrica\gradle`, also from the 08-27 entry: keeping
 * GRADLE_USER_HOME under Fabrica rather than %USERPROFILE%\.gradle makes the
 * toolchain self-contained, cleanly uninstallable, and non-colliding on a
 * shared machine. Exported for the run config to use as an env var -- this
 * module only owns the path, not the build.
 */
export const getGradleUserHome = (): string =>
  path.join(getFabricaDataRoot(), 'gradle');

/** Same resolver shape as mirrorProcess.ts and main.ts. */
const getBundledRuntimeRoot = (): string => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'runtimes');
  }

  return path.join(app.getAppPath(), 'resources', 'runtimes');
};

/**
 * The bundled Temurin 17 JDK. `sdkmanager` is a JVM program and will not run
 * without one.
 *
 * Falls back to JAVA_HOME and then to PATH with a warning, matching
 * `getBundledRuntimeBinary()`'s fallback convention in main.ts -- and unlike
 * ws-scrcpy, a system JDK genuinely is a valid substitute here, so falling back
 * is correct rather than a papered-over failure.
 *
 * NOTE: `resources/runtimes/jdk/` does not exist in the working tree yet. It is
 * gitignored like every other bundled runtime and has to be repopulated locally
 * before packaging; until it is, this resolves to the system JDK.
 */
const resolveJavaHome = (): string | null => {
  const bundled = path.join(getBundledRuntimeRoot(), 'jdk');
  if (fs.existsSync(path.join(bundled, 'bin', 'java.exe'))) {
    return bundled;
  }

  if (process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)) {
    console.warn(
      '[android-sdk] Bundled JDK not found at resources/runtimes/jdk; falling back to JAVA_HOME.',
    );
    return process.env.JAVA_HOME;
  }

  console.warn(
    '[android-sdk] No bundled JDK and no JAVA_HOME; sdkmanager will have to find java on PATH.',
  );
  return null;
};

const getCmdlineToolsBin = (): string =>
  path.join(getAndroidSdkRoot(), 'cmdline-tools', 'latest', 'bin');

const getSdkManagerPath = (): string =>
  path.join(
    getCmdlineToolsBin(),
    process.platform === 'win32' ? 'sdkmanager.bat' : 'sdkmanager',
  );

export const getAdbPath = (): string =>
  path.join(
    getAndroidSdkRoot(),
    'platform-tools',
    process.platform === 'win32' ? 'adb.exe' : 'adb',
  );

// ---------------------------------------------------------------------------
// Progress protocol.
//
// One discriminated union over one channel, rather than a channel per phase.
// The renderer switches on `phase` and cannot receive a shape it did not ask
// for. Same relay convention as `git:progress` and `terminal:output`:
// `event.sender.send`-style push, with the heavy lifting staying in main.

export type AndroidSdkPhase =
  | 'idle'
  | 'preflight'
  | 'downloading'
  | 'extracting'
  | 'licenses'
  | 'awaiting-license'
  | 'installing'
  | 'done'
  | 'cancelled'
  | 'error';

export type AndroidSdkProgress = {
  phase: AndroidSdkPhase;
  /** Human-readable one-liner, safe to render directly. */
  message: string;
  /** 0-100 for the CURRENT phase only, absent when genuinely unknowable. */
  percent?: number;
  receivedBytes?: number;
  totalBytes?: number;
  /** Which SDK package is being installed, during 'installing'. */
  packageName?: string;
  /**
   * Raw license text, during 'licenses'/'awaiting-license'. This is the actual
   * text sdkmanager printed -- it is shown to the student verbatim, never
   * summarized by us.
   */
  licenseText?: string;
  /** Populated on 'error' only. */
  error?: string;
};

const PROGRESS_CHANNEL = 'android:sdk-progress';

/**
 * Broadcast to every open window rather than replying to one sender. The fetch
 * outlives any single renderer call -- a reload mid-download would otherwise
 * leave the new page with a running install and no events. There is one window
 * in Fabrica, so this is a loop of length one that costs nothing and removes a
 * whole class of "progress bar stuck at 12%" bug.
 */
const emit = (progress: AndroidSdkProgress): void => {
  lastProgress = progress;
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(PROGRESS_CHANNEL, progress);
    }
  });
};

// ---------------------------------------------------------------------------
// Lifecycle state. Same shape as mirrorProcess.ts: module-level, with an
// in-flight promise so two callers share one run instead of racing two.

let activeChild: ChildProcess | null = null;
let activeRequest: ReturnType<typeof https.get> | null = null;
let fetching: Promise<AndroidSdkStatus> | null = null;
let cancelled = false;
let lastProgress: AndroidSdkProgress = { phase: 'idle', message: 'Not started.' };

/** Resolver for the license prompt the renderer is currently answering. */
let pendingLicenseResolve: ((accepted: boolean) => void) | null = null;

// ---------------------------------------------------------------------------
// Item 1 -- first-run check.

export type AndroidSdkStatus = {
  installed: boolean;
  sdkRoot: string;
  adbPath: string;
  /** Which required pieces are absent. Empty when `installed` is true. */
  missing: string[];
  /** First line of `adb --version`, proving it actually RUNS, not just exists. */
  adbVersion?: string;
  error?: string;
};

const runCapture = (
  command: string,
  args: string[],
  timeoutMs = 15_000,
): Promise<{ code: number | null; stdout: string; stderr: string }> =>
  new Promise((resolve) => {
    // `shell: true` on Windows because sdkmanager is a .bat, which CreateProcess
    // cannot execute directly. Every argument passed here is a module-level
    // constant or a path we built ourselves -- no user input reaches this.
    const child = spawn(command, args, {
      shell: process.platform === 'win32',
      env: buildToolEnv(),
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    }, timeoutMs);

    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr || String(err) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });

/**
 * Is the SDK already fetched AND usable?
 *
 * "Usable" is checked by RUNNING `adb --version`, not by `existsSync` alone.
 * A half-extracted platform-tools folder from an interrupted first attempt
 * leaves adb.exe on disk in a state that cannot execute, and an existence check
 * would call that success and send the student into a build that fails much
 * later with a far worse error. Same principle as mirrorProcess.ts asserting on
 * the server's actual readiness line rather than on the fork returning.
 *
 * Cheap enough to call on every app start, and it never throws: a broken SDK
 * reports `installed: false` with a reason, it does not propagate an exception
 * into startup.
 */
export const checkAndroidSdk = async (): Promise<AndroidSdkStatus> => {
  const sdkRoot = getAndroidSdkRoot();
  const adbPath = getAdbPath();
  const missing: string[] = [];

  if (!fs.existsSync(sdkRoot)) missing.push('android-sdk');
  if (!fs.existsSync(path.join(sdkRoot, 'platform-tools'))) missing.push('platform-tools');
  if (!fs.existsSync(adbPath)) missing.push('adb');
  if (!fs.existsSync(getSdkManagerPath())) missing.push('cmdline-tools');

  if (missing.length > 0) {
    return { installed: false, sdkRoot, adbPath, missing };
  }

  const probe = await runCapture(adbPath, ['--version']);
  if (probe.code !== 0) {
    return {
      installed: false,
      sdkRoot,
      adbPath,
      missing: ['adb (present but not runnable)'],
      error: (probe.stderr || probe.stdout).trim() || 'adb --version failed.',
    };
  }

  return {
    installed: true,
    sdkRoot,
    adbPath,
    missing: [],
    adbVersion: probe.stdout.trim().split('\n')[0],
  };
};

// ---------------------------------------------------------------------------
// Item 4 -- preflight failure cases, checked BEFORE anything is downloaded.

const hasConnectivity = (): Promise<boolean> =>
  new Promise((resolve) => {
    dns.lookup(CONNECTIVITY_PROBE_HOST, (err) => resolve(!err));
  });

/**
 * Free-space check via `fs.statfs` (Node 18.15+, so available on the Node 22
 * this runs under). Returns null when the platform will not answer rather than
 * guessing -- an unknown free-space figure must not block a fetch that would
 * have succeeded.
 */
const getFreeBytes = async (dir: string): Promise<number | null> => {
  try {
    // Walk up to the nearest directory that exists: statfs on a path that has
    // not been created yet fails, and on first run the SDK root never exists.
    let probe = dir;
    while (!fs.existsSync(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) return null;
      probe = parent;
    }

    const stats = await fs.promises.statfs(probe);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
};

const formatGb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)}GB`;

/** Refuses the run while the download URL is still the unverified placeholder. */
const verifyToolsUrlPinned = (): void => {
  if (CMDLINE_TOOLS_URL_VERIFIED) return;

  throw new Error(
    'The Android command-line tools download URL has not been verified yet.\n' +
      'DECISIONS.md pins cmdline-tools to v23.0, but the download URL uses ' +
      "Google's build number, which is published only on the Android Studio " +
      'download page and is not derivable from the version string.\n\n' +
      'Confirm the "Command line tools only" URL at ' +
      'https://developer.android.com/studio, set CMDLINE_TOOLS_URL to it in ' +
      'src/main/androidSdk.ts, and flip CMDLINE_TOOLS_URL_VERIFIED to true.\n\n' +
      'This check exists so an unverified pin fails here, loudly, instead of ' +
      'installing a toolchain nobody validated and surfacing as a confusing ' +
      'build failure much later.',
  );
};

// ---------------------------------------------------------------------------
// Download.

const buildToolEnv = (): NodeJS.ProcessEnv => {
  const javaHome = resolveJavaHome();
  return {
    ...process.env,
    ...(javaHome ? { JAVA_HOME: javaHome } : {}),
    ANDROID_HOME: getAndroidSdkRoot(),
    ANDROID_SDK_ROOT: getAndroidSdkRoot(),
  };
};

/**
 * Streamed download with progress, written to `<dest>.part` and renamed only on
 * a clean finish.
 *
 * The `.part` staging is what makes a mid-download network failure safe: a
 * truncated archive can never be mistaken for a complete one by a later run,
 * because the real filename only ever appears after the last byte lands. The
 * partial file is also deleted on every failure path, so a failed attempt
 * leaves no debris and costs no disk.
 *
 * Uses Node's own `https` rather than adding a fetch/download dependency --
 * same reasoning as mirrorProcess.ts's `net`-based port probe: this feature adds
 * zero entries to package.json.
 */
const downloadFile = (url: string, dest: string, redirectsLeft = MAX_REDIRECTS): Promise<void> =>
  new Promise((resolve, reject) => {
    const partPath = `${dest}.part`;

    const failWith = (err: Error) => {
      try {
        if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
      } catch {
        // Cleanup is best-effort; the real error is the one worth reporting.
      }
      reject(err);
    };

    const request = https.get(url, { timeout: DOWNLOAD_STALL_TIMEOUT_MS }, (response) => {
      const status = response.statusCode ?? 0;

      // dl.google.com redirects; follow, but bounded.
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirectsLeft <= 0) {
          failWith(new Error('Too many redirects while downloading the Android command-line tools.'));
          return;
        }
        downloadFile(response.headers.location, dest, redirectsLeft - 1).then(resolve, reject);
        return;
      }

      if (status !== 200) {
        response.resume();
        failWith(
          new Error(
            `Download failed with HTTP ${status}. The pinned command-line tools URL may be wrong or no longer served.`,
          ),
        );
        return;
      }

      const totalBytes = Number(response.headers['content-length']) || undefined;
      let receivedBytes = 0;
      const file = fs.createWriteStream(partPath);

      response.on('data', (chunk: Buffer) => {
        receivedBytes += chunk.length;
        emit({
          phase: 'downloading',
          message: totalBytes
            ? `Downloading Android command-line tools (${formatGb(receivedBytes)} of ${formatGb(totalBytes)})`
            : `Downloading Android command-line tools (${formatGb(receivedBytes)})`,
          percent: totalBytes ? Math.round((receivedBytes / totalBytes) * 100) : undefined,
          receivedBytes,
          totalBytes,
        });
      });

      response.on('error', (err) => {
        file.destroy();
        failWith(new Error(`Network error during download: ${err.message}`));
      });

      // ENOSPC lands here, not on the response: the disk fills as the stream is
      // written, which can happen even after the preflight check passed if
      // something else on the machine consumed the space meanwhile.
      file.on('error', (err: NodeJS.ErrnoException) => {
        failWith(
          err.code === 'ENOSPC'
            ? new Error(
                'The disk filled up while downloading the Android SDK. Free up space and start the setup again -- the partial download has been discarded.',
              )
            : new Error(`Could not write the download to disk: ${err.message}`),
        );
      });

      file.on('finish', () => {
        file.close(() => {
          if (cancelled) {
            failWith(new Error('Cancelled.'));
            return;
          }
          try {
            fs.renameSync(partPath, dest);
            resolve();
          } catch (err) {
            failWith(new Error(`Could not finalize the download: ${String(err)}`));
          }
        });
      });

      response.pipe(file);
    });

    activeRequest = request;

    // A silently stalled connection -- captive portal, dropped wifi mid-transfer
    // -- otherwise hangs forever with a progress bar frozen at whatever percent
    // it reached, which reads as a crash.
    request.on('timeout', () => {
      request.destroy();
      failWith(
        new Error(
          `The download stalled for ${DOWNLOAD_STALL_TIMEOUT_MS / 1000}s with no data. Check the connection and start the setup again.`,
        ),
      );
    });

    request.on('error', (err) => {
      failWith(new Error(`Could not reach the Android SDK download server: ${err.message}`));
    });
  });

// ---------------------------------------------------------------------------
// Extraction.

/**
 * The nested-folder trap, called out in DECISIONS.md as "the common failure
 * point": the zip contains a top-level `cmdline-tools/`, but sdkmanager
 * requires `<sdk>/cmdline-tools/latest/bin/...`. Extracting in place produces
 * `cmdline-tools/bin`, which looks right and does not work.
 *
 * Extracted to a staging folder and then MOVED into place, so an interrupted
 * extraction never leaves a half-populated `latest/` that the check above would
 * have to distinguish from a good one.
 *
 * Uses PowerShell's Expand-Archive rather than a zip dependency, consistent with
 * this feature adding nothing to package.json.
 */
const extractCmdlineTools = async (zipPath: string): Promise<void> => {
  const sdkRoot = getAndroidSdkRoot();
  const staging = path.join(sdkRoot, '.cmdline-tools-staging');
  const finalDir = path.join(sdkRoot, 'cmdline-tools', 'latest');

  emit({ phase: 'extracting', message: 'Extracting the Android command-line tools...' });

  await fs.promises.rm(staging, { recursive: true, force: true });
  await fs.promises.mkdir(staging, { recursive: true });

  const result = await runCapture(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${staging}' -Force`,
    ],
    120_000,
  );

  if (result.code !== 0) {
    await fs.promises.rm(staging, { recursive: true, force: true });
    throw new Error(
      `Could not extract the Android command-line tools archive.\n${(result.stderr || result.stdout).trim()}`,
    );
  }

  const inner = path.join(staging, 'cmdline-tools');
  const source = fs.existsSync(inner) ? inner : staging;

  await fs.promises.rm(finalDir, { recursive: true, force: true });
  await fs.promises.mkdir(path.dirname(finalDir), { recursive: true });
  await fs.promises.rename(source, finalDir);
  await fs.promises.rm(staging, { recursive: true, force: true });
};

// ---------------------------------------------------------------------------
// Item 3 -- license acceptance. Explicit, never silent.

/**
 * Runs `sdkmanager --licenses` and relays each license to the renderer for a
 * real decision.
 *
 * The whole design of this function is the "not defensible in a thesis" note in
 * DECISIONS.md. Piping `y` into sdkmanager would be one line and would work;
 * it would also mean Fabrica accepting Google's licence terms on a student's
 * behalf, silently, without them having seen the text. So instead: the license
 * text sdkmanager prints is forwarded VERBATIM (never summarized by us), the
 * process is left blocked on its own stdin prompt, and nothing is written until
 * the renderer sends a decision back through `respondToLicense()`.
 *
 * Declining is a real, supported outcome, not a dead end that loops: `n` is
 * written, sdkmanager skips that package, and the flow reports which packages
 * were declined. The student keeps a working IDE without Android builds --
 * which is the correct trade, and is exactly the degradation item 4 asks for.
 */
const acceptLicensesInteractively = (): Promise<{ accepted: boolean }> =>
  new Promise((resolve, reject) => {
    emit({ phase: 'licenses', message: 'Reviewing Android SDK licenses...' });

    const child = spawn(getSdkManagerPath(), [`--sdk_root=${getAndroidSdkRoot()}`, '--licenses'], {
      shell: process.platform === 'win32',
      env: buildToolEnv(),
    });
    activeChild = child;

    let buffer = '';
    let sawPrompt = false;
    let anyDeclined = false;

    const answer = (accepted: boolean) => {
      if (!accepted) anyDeclined = true;
      try {
        child.stdin?.write(accepted ? 'y\n' : 'n\n');
      } catch (err) {
        console.warn('[android-sdk] Could not write the license response:', err);
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      buffer += text;
      process.stdout.write(text);

      // sdkmanager signals it wants an answer with a trailing "(y/N)" prompt.
      // Everything accumulated since the last prompt IS the license text, so it
      // is handed over whole rather than line-by-line -- a licence split across
      // progress events would be unreadable, and unreadable defeats the point.
      if (/\(y\/N\)\s*:?\s*$/i.test(buffer.trimEnd())) {
        sawPrompt = true;
        const licenseText = buffer.trim();
        buffer = '';

        emit({
          phase: 'awaiting-license',
          message: 'Android SDK license -- your explicit acceptance is required to continue.',
          licenseText,
        });

        // Parked until the renderer answers. `pendingLicenseResolve` is the only
        // thing that can un-park it, so a student can read the text for as long
        // as they like; there is deliberately no timeout on a legal decision.
        pendingLicenseResolve = (accepted: boolean) => {
          pendingLicenseResolve = null;
          answer(accepted);
        };
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk.toString());
    });

    child.on('error', (err) => {
      activeChild = null;
      pendingLicenseResolve = null;
      reject(new Error(`Could not run sdkmanager --licenses: ${err.message}`));
    });

    child.on('close', (code) => {
      activeChild = null;
      pendingLicenseResolve = null;

      if (cancelled) {
        resolve({ accepted: false });
        return;
      }

      // Exit 0 with no prompt seen means every license was already accepted on
      // a previous run -- sdkmanager writes acceptance hashes under
      // <sdk>/licenses/, so this is a legitimate no-op, not a silent skip.
      if (code === 0) {
        resolve({ accepted: !anyDeclined });
        return;
      }

      if (!sawPrompt) {
        reject(
          new Error(
            `sdkmanager --licenses exited with code ${code} without prompting. The command-line tools may not have extracted correctly.`,
          ),
        );
        return;
      }

      resolve({ accepted: false });
    });
  });

/**
 * The renderer's answer to the license currently on screen. Exposed over IPC as
 * `android:licenseRespond`.
 */
export const respondToLicense = (accepted: boolean): void => {
  if (!pendingLicenseResolve) {
    console.warn('[android-sdk] License response arrived with no prompt waiting; ignoring.');
    return;
  }

  emit({
    phase: 'licenses',
    message: accepted ? 'License accepted. Continuing...' : 'License declined.',
  });
  pendingLicenseResolve(accepted);
};

// ---------------------------------------------------------------------------
// Package installation.

/**
 * `sdkmanager <packages>` with progress relayed per line.
 *
 * sdkmanager reports as `[=====   ] 45% Downloading ...`; the percent is parsed
 * out for a real progress bar and the raw line is kept as the message so the
 * student sees which component is moving. Deliberately NOT `--verbose`: the
 * default output is already one line per state change, and verbose turns a
 * readable install into a wall.
 */
const installPackages = (): Promise<void> =>
  new Promise((resolve, reject) => {
    emit({
      phase: 'installing',
      message: `Installing ${SDK_PACKAGES.length} Android SDK components (~2.8GB). This takes a while on a school connection.`,
      percent: 0,
    });

    const child = spawn(
      getSdkManagerPath(),
      [`--sdk_root=${getAndroidSdkRoot()}`, ...SDK_PACKAGES],
      { shell: process.platform === 'win32', env: buildToolEnv() },
    );
    activeChild = child;

    let stderrTail = '';

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const percentMatch = trimmed.match(/(\d{1,3})\s*%/);
      const packageMatch = SDK_PACKAGES.find((pkg) => trimmed.includes(pkg));

      emit({
        phase: 'installing',
        message: trimmed,
        percent: percentMatch ? Number(percentMatch[1]) : undefined,
        packageName: packageMatch,
      });
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      process.stdout.write(text);

      // A license prompt can still appear here if a package's terms were not
      // covered by the --licenses pass. It is routed through the same explicit
      // acceptance path rather than auto-answered -- there is no code path in
      // this module that writes 'y' without a student having pressed something.
      if (/\(y\/N\)\s*:?\s*$/i.test(text.trimEnd())) {
        emit({
          phase: 'awaiting-license',
          message: 'An additional Android SDK license needs your acceptance.',
          licenseText: text.trim(),
        });
        pendingLicenseResolve = (accepted: boolean) => {
          pendingLicenseResolve = null;
          child.stdin?.write(accepted ? 'y\n' : 'n\n');
        };
        return;
      }

      text.split('\n').forEach(handleLine);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      process.stderr.write(text);
      // Kept bounded: sdkmanager can emit a very large stack, and only the tail
      // is useful in an error message.
      stderrTail = `${stderrTail}${text}`.slice(-4000);
    });

    child.on('error', (err) => {
      activeChild = null;
      reject(new Error(`Could not run sdkmanager: ${err.message}`));
    });

    child.on('close', (code) => {
      activeChild = null;

      if (cancelled) {
        reject(new Error('Cancelled.'));
        return;
      }

      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `sdkmanager exited with code ${code} while installing SDK components.` +
            (stderrTail.trim() ? `\n\n${stderrTail.trim()}` : ''),
        ),
      );
    });
  });

// ---------------------------------------------------------------------------
// Item 2 -- the fetch flow, end to end.

/**
 * Run the first-run fetch. Safe to call repeatedly: returns the already-good
 * status when the SDK is present, and joins the in-flight run when one is
 * going, matching `startMirrorServer()`'s coalescing contract so a double-click
 * cannot start two installs onto the same directory.
 *
 * NEVER called automatically on app start. It is a student-initiated action --
 * a ~3.7GB download must not begin because someone opened an IDE.
 */
export const fetchAndroidSdk = async (): Promise<AndroidSdkStatus> => {
  const existing = await checkAndroidSdk();
  if (existing.installed) {
    emit({ phase: 'done', message: 'Android SDK is already installed.' });
    return existing;
  }

  if (fetching) return fetching;

  cancelled = false;

  fetching = (async (): Promise<AndroidSdkStatus> => {
    const sdkRoot = getAndroidSdkRoot();

    try {
      emit({ phase: 'preflight', message: 'Checking prerequisites...' });

      verifyToolsUrlPinned();

      if (!(await hasConnectivity())) {
        throw new Error(
          'No internet connection.\n\n' +
            'The Android SDK is downloaded from Google on first use rather than ' +
            'shipped inside Fabrica, so this one step needs a connection. ' +
            'Everything else in Fabrica — including mirroring a connected phone — ' +
            'works offline; only building an APK needs this. Reconnect and run ' +
            'the setup again whenever you are ready.',
        );
      }

      const freeBytes = await getFreeBytes(sdkRoot);
      if (freeBytes !== null && freeBytes < REQUIRED_FREE_BYTES) {
        throw new Error(
          `Not enough disk space. The Android SDK needs about ${formatGb(REQUIRED_FREE_BYTES)} free ` +
            `(~3.7GB downloaded, ~5.6GB after the first build) and this drive has ` +
            `${formatGb(freeBytes)} available.\n\nFree up some space and run the setup again.`,
        );
      }

      await fs.promises.mkdir(sdkRoot, { recursive: true });

      const zipPath = path.join(sdkRoot, 'commandlinetools.zip');
      await downloadFile(CMDLINE_TOOLS_URL, zipPath);
      if (cancelled) throw new Error('Cancelled.');

      await extractCmdlineTools(zipPath);
      // The archive is ~150MB of no further use once extracted.
      await fs.promises.rm(zipPath, { force: true });
      if (cancelled) throw new Error('Cancelled.');

      const { accepted } = await acceptLicensesInteractively();
      if (cancelled) throw new Error('Cancelled.');

      if (!accepted) {
        emit({
          phase: 'error',
          message: 'Setup stopped: the Android SDK licenses were not accepted.',
          error:
            'The Android SDK licenses were declined, so the SDK components were not installed.\n\n' +
            'Nothing else in Fabrica is affected — you can keep coding, run every ' +
            'other language, and mirror a connected phone. Only building an APK ' +
            'needs the SDK. Run the setup again if you change your mind.',
        });
        return { ...(await checkAndroidSdk()), error: 'Licenses declined.' };
      }

      await installPackages();
      if (cancelled) throw new Error('Cancelled.');

      const status = await checkAndroidSdk();

      if (!status.installed) {
        // sdkmanager exited 0 but the result does not verify. Reported as an
        // error rather than trusted, for the same reason the check above runs
        // adb instead of trusting existsSync.
        emit({
          phase: 'error',
          message: 'Setup finished but the Android SDK did not verify.',
          error: `The install reported success, but these are still missing: ${status.missing.join(', ')}.`,
        });
        return status;
      }

      emit({
        phase: 'done',
        message: 'Android SDK installed. You can now build APKs.',
        percent: 100,
      });
      return status;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (cancelled || message === 'Cancelled.') {
        emit({ phase: 'cancelled', message: 'Android SDK setup cancelled.' });
      } else {
        console.error('[android-sdk] Fetch failed:', message);
        emit({ phase: 'error', message: 'Android SDK setup failed.', error: message });
      }

      // The partial SDK is deliberately LEFT on disk: sdkmanager is resumable
      // per-package, so a retry after a dropped connection continues rather than
      // re-downloading 2.8GB. The only thing removed is the `.part` file, which
      // downloadFile() already handles, since a truncated archive is the one
      // artifact that is worse than useless.
      return { ...(await checkAndroidSdk()), error: message };
    } finally {
      activeChild = null;
      activeRequest = null;
      pendingLicenseResolve = null;
    }
  })();

  try {
    return await fetching;
  } finally {
    fetching = null;
  }
};

// ---------------------------------------------------------------------------
// Teardown. Same contract as mirrorProcess.ts's stopMirrorServer(): never
// throws, safe to call when nothing is running.

export const cancelAndroidSdkFetch = (): void => {
  if (!fetching) return;

  cancelled = true;

  // A license prompt parked on stdin would otherwise keep the child alive
  // forever waiting for an answer that is no longer coming.
  if (pendingLicenseResolve) {
    pendingLicenseResolve(false);
    pendingLicenseResolve = null;
  }

  try {
    activeRequest?.destroy();
  } catch {
    // Already closed.
  }

  try {
    activeChild?.kill();
  } catch {
    // Already gone.
  }
};

export const getAndroidSdkProgress = (): AndroidSdkProgress => lastProgress;

/**
 * Nothing may outlive the app -- an orphaned sdkmanager would keep writing into
 * the SDK directory after Fabrica closed, and a half-written package is exactly
 * what makes the next run's verification fail. Same rule, and the same hook, as
 * mirrorProcess.ts uses for the ws-scrcpy server.
 */
app.on('before-quit', () => {
  cancelAndroidSdkFetch();
});

// ---------------------------------------------------------------------------
// IPC surface. Registered here rather than in main.ts so the channel names sit
// next to the code that serves them -- mirrorProcess.ts exports its two
// functions for main.ts to wire because they are two lines; this module has a
// stateful protocol (progress, license round-trip, cancel) that is easier to
// keep correct in one place.

export const registerAndroidSdkIpc = (): void => {
  ipcMain.handle('android:check', async () => checkAndroidSdk());
  ipcMain.handle('android:fetch', async () => fetchAndroidSdk());
  ipcMain.handle('android:cancel', async () => cancelAndroidSdkFetch());
  ipcMain.handle('android:getProgress', () => getAndroidSdkProgress());
  ipcMain.handle('android:licenseRespond', (_event, accepted: boolean) => {
    respondToLicense(accepted);
  });
};
