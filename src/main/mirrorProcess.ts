/* eslint no-console: off */

/**
 * Embedded Android device mirroring -- main-process half.
 *
 * Forks the pre-built ws-scrcpy server that ships in
 * `resources/runtimes/ws-scrcpy/` and hands the renderer back the port it
 * bound to, so a <webview> can point at `http://localhost:<port>`. The
 * renderer half (panel component + webview) is a separate lane and is NOT
 * touched from here.
 *
 * Three things about the bundle are load-bearing and easy to "fix" wrongly
 * (see DECISIONS.md 2026-08-28):
 *
 *   1. `node_modules/node-pty/` inside the bundle is a DELIBERATE STUB whose
 *      `spawn()` only throws. ws-scrcpy's RemoteShell module `require()`s
 *      node-pty unconditionally at startup, so the server will not boot
 *      without *something* at that path -- but Fabrica never opens the device
 *      shell panel, so the throwing path is never reached. The stub is what
 *      keeps this feature free of any native compilation. Do not replace it
 *      with the real package.
 *
 *   2. The bundle is FLAT: `index.js`, `public/` and `vendor/` sit directly at
 *      the ws-scrcpy root, not under a `dist/` subdirectory. Its own
 *      package.json declares `"main": "index.js"`.
 *
 *   3. The server resolves both `public/` and `vendor/Genymobile/scrcpy` from
 *      its own `__dirname`, so it is cwd-independent -- `cwd` is still set to
 *      the bundle root below, but only for tidiness, not correctness.
 *
 * Mirroring has NO Android SDK dependency: ws-scrcpy speaks the ADB wire
 * protocol directly via `@dead50f7/adbkit` and never spawns `adb.exe`. It
 * therefore works on a fresh install with no setup wizard run.
 */
import fs from 'fs';
import net from 'net';
import path from 'path';
import { app, utilityProcess } from 'electron';

// The line the server prints to stdout once its HTTP/WS listener is up
// (`Utils.printListeningMsg` -> `console.log("Listening on:\n\t" + ...)`).
// Verified against the built `index.js` in the bundle, not assumed.
const READY_MARKER = 'Listening on:';

// The server has no work to do before listening -- no model load, no network
// fetch -- so anything past this means it is wedged rather than slow. Without
// a bound, a server that boots but never prints would leave `mirror:start`
// pending forever and hang the renderer's loading state with no error.
const STARTUP_TIMEOUT_MS = 20_000;

type MirrorHandle = ReturnType<typeof utilityProcess.fork>;

// Module-level lifecycle state. `starting` exists so two quick calls to
// startMirrorServer() (a double-click on the panel button, a remount) share
// one fork instead of racing two servers onto two ports.
let child: MirrorHandle | null = null;
let currentPort: number | null = null;
let currentConfigPath: string | null = null;
let starting: Promise<{ port: number }> | null = null;

/**
 * Mirrors `getBundledRuntimeRoot()` in main.ts. Deliberately duplicated rather
 * than imported: main.ts imports THIS module, so importing back would be
 * circular. Same precedent as llm.ts, which also does its own `app.isPackaged`
 * branching. If the packaged layout ever changes, both must change together.
 *
 * Note this is a real on-disk directory in BOTH modes -- `resources/runtimes`
 * ships via electron-builder's `extraResources`, which copies alongside
 * app.asar rather than into it. That is why no asarUnpack entry is needed for
 * the fork to work (see the report/DECISIONS.md note).
 */
const getBundledRuntimeRoot = () => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'runtimes');
  }

  return path.join(app.getAppPath(), 'resources', 'runtimes');
};

const getMirrorServerDir = () => path.join(getBundledRuntimeRoot(), 'ws-scrcpy');

const getMirrorServerEntry = () => path.join(getMirrorServerDir(), 'index.js');

/**
 * Ask the OS for a free port by binding to 0 and reading back what it
 * assigned. Deliberately uses Node's own `net` rather than adding portfinder
 * as a Fabrica dependency -- the bundle carries its own copy for its internal
 * use, but this feature adds zero entries to package.json.
 *
 * Bound without a host so the port is free on every interface, matching where
 * the server itself listens. There is an unavoidable TOCTOU gap between
 * closing this probe and the server binding; it is the standard technique and
 * the window is microseconds on a machine that is not exhausting ports.
 */
const findFreePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();

    probe.on('error', reject);
    probe.listen(0, () => {
      const address = probe.address();

      if (address === null || typeof address === 'string') {
        probe.close();
        reject(new Error('Could not determine a free port for the mirror server.'));
        return;
      }

      const { port } = address;
      probe.close(() => resolve(port));
    });
  });

const removeConfigFile = () => {
  if (!currentConfigPath) {
    return;
  }

  try {
    fs.unlinkSync(currentConfigPath);
  } catch {
    // Best-effort cleanup in the OS temp directory -- a leftover ~60-byte
    // JSON file is not worth failing a shutdown over.
  }

  currentConfigPath = null;
};

const clearHandles = () => {
  child = null;
  currentPort = null;
  removeConfigFile();
};

/**
 * Fork the bundled ws-scrcpy server and resolve once it is actually listening.
 *
 * Safe to call repeatedly: returns the already-running server's port if one is
 * up, and joins the in-flight fork if one is mid-start.
 */
export const startMirrorServer = async (): Promise<{ port: number }> => {
  console.log('[MIRROR:startMirrorServer] Called, current state:', { child: child !== null, currentPort });
  
  if (child && currentPort !== null) {
    console.log('[MIRROR:startMirrorServer-reuse] Server already running, returning existing port:', currentPort);
    return { port: currentPort };
  }

  if (starting) {
    console.log('[MIRROR:startMirrorServer-wait-existing] Fork in progress, joining existing start promise');
    return starting;
  }

  starting = (async () => {
    console.log('[MIRROR:startMirrorServer-begin-fork] Beginning fork of ws-scrcpy server');
    const entry = getMirrorServerEntry();

    // No PATH fallback is possible here, unlike the runtime binaries in
    // main.ts -- there is no "system ws-scrcpy" to fall back to, so a missing
    // bundle is a hard, clearly-worded failure rather than a warning.
    if (!fs.existsSync(entry)) {
      console.error('[MIRROR:startMirrorServer-not-found] Entry point does not exist:', entry);
      throw new Error(
        `Device mirroring server not found at:\n  ${entry}\n` +
          `The ws-scrcpy bundle is missing from resources/runtimes/. It is ` +
          `gitignored like the other bundled runtimes, so repopulate it ` +
          `locally before running or packaging.`,
      );
    }

    const port = await findFreePort();
    console.log('[MIRROR:startMirrorServer-port-allocated] Free port allocated:', port);

    // The server reads its port from a config file pointed at by
    // WS_SCRCPY_CONFIG, NOT from a CLI flag or a port env var. `.json` is
    // parsed with JSON.parse (the yaml branch is extension-matched), and
    // `parseServerItem` reads exactly these two keys.
    const configPath = path.join(
      app.getPath('temp'),
      `fabrica-ws-scrcpy-${port}.json`,
    );
    fs.writeFileSync(
      configPath,
      JSON.stringify({ server: [{ secure: false, port }] }),
      'utf-8',
    );
    currentConfigPath = configPath;
    console.log('[MIRROR:startMirrorServer-config-written] Config file written:', configPath);

    const forked = utilityProcess.fork(entry, [], {
      serviceName: 'fabrica-mirror',
      cwd: getMirrorServerDir(),
      // 'pipe', not the default 'inherit' -- for the same reason llm.ts pipes
      // its worker: a utility process is launched through Chromium's process
      // launcher, so inherited stdio handles do not survive reliably in this
      // dev setup. Piping is also what makes the readiness detection below
      // possible at all, since the readiness signal IS a stdout line.
      stdio: 'pipe',
      env: {
        ...process.env,
        WS_SCRCPY_CONFIG: configPath,
      } as Record<string, string>,
    });

    return new Promise<{ port: number }>((resolve, reject) => {
      let settled = false;
      let stdoutBuffer = '';
      let stderrBuffer = '';

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        console.error('[MIRROR:startMirrorServer-timeout] Server startup timeout after', STARTUP_TIMEOUT_MS / 1000, 's');
        finish(() => {
          try {
            forked.kill();
          } catch {
            // Already gone; nothing to clean up.
          }
          clearHandles();
          reject(
            new Error(
              `Device mirroring server did not start within ` +
                `${STARTUP_TIMEOUT_MS / 1000}s (never printed "${READY_MARKER}").` +
                (stderrBuffer ? `\nServer error output:\n${stderrBuffer.trim()}` : ''),
            ),
          );
        });
      }, STARTUP_TIMEOUT_MS);

      // Listeners attach synchronously on the line after fork() and before any
      // await, so nothing printed at boot -- including the readiness line on a
      // fast start -- can be missed: a piped readable stays paused and buffers
      // until a 'data' listener exists.
      forked.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        // Relayed raw into main's stdout, same convention as the inference
        // worker, so the server's own logs stay visible in the dev terminal.
        process.stdout.write(text);

        if (settled) return;

        stdoutBuffer += text;
        if (stdoutBuffer.includes(READY_MARKER)) {
          console.log('[MIRROR:startMirrorServer-ready] Server ready marker detected, resolving');
          finish(() => {
            child = forked;
            currentPort = port;
            console.log('[MIRROR:startMirrorServer-complete] Server started successfully on port:', port);
            resolve({ port });
          });
        }
      });

      forked.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        process.stderr.write(text);
        // Captured so an early exit can report WHY, rather than just a code.
        stderrBuffer += text;
      });

      forked.on('exit', (code) => {
        console.log('[MIRROR:startMirrorServer-exit] Server process exited with code:', code);
        // Before ready: the start failed and the caller is still waiting.
        finish(() => {
          clearHandles();
          reject(
            new Error(
              `Device mirroring server exited with code ${code} before it ` +
                `started listening.` +
                (stderrBuffer ? `\nServer error output:\n${stderrBuffer.trim()}` : '') +
                (stdoutBuffer ? `\nServer output:\n${stdoutBuffer.trim()}` : ''),
            ),
          );
        });

        // After ready: a crash mid-session. Drop the stale handles so the next
        // start() forks a fresh server instead of handing back a dead port.
        if (child === forked) {
          console.warn(`[mirror] Server exited with code ${code}.`);
          clearHandles();
        }
      });
    });
  })();

  try {
    return await starting;
  } finally {
    starting = null;
  }
};

/**
 * Kill the running server, if any. No-op (never throws) when nothing is up, so
 * it is safe to call from a quit handler or a renderer that has lost track of
 * state.
 *
 * The kill and the temp-file cleanup are both synchronous on purpose: the
 * before-quit handler below does not await this, and the process may exit
 * immediately after.
 */
export const stopMirrorServer = async (): Promise<void> => {
  console.log('[MIRROR:stopMirrorServer] Called, current state:', { child: child !== null, currentPort });
  
  if (!child) {
    // Still clear any config file left behind by a failed start.
    console.log('[MIRROR:stopMirrorServer-noop] No server running, cleaning up config only');
    removeConfigFile();
    return;
  }

  console.log('[MIRROR:stopMirrorServer-killing] Killing server process on port:', currentPort);
  const running = child;
  // Cleared before the kill so the 'exit' handler's `child === forked` branch
  // does not double-log a crash warning for a shutdown we asked for.
  child = null;

  try {
    running.kill();
    console.log('[MIRROR:stopMirrorServer-killed] Server process killed');
  } catch (err) {
    console.warn(`[mirror] Failed to kill mirror server: ${String(err)}`);
  }

  currentPort = null;
  removeConfigFile();
  console.log('[MIRROR:stopMirrorServer-complete] Cleanup complete');
};

// Nothing may dangle after Fabrica closes -- on a shared lab machine an
// orphaned server would hold both its port and the device's scrcpy connection,
// so the next launch (or the next student) would fail to mirror at all.
app.on('before-quit', () => {
  stopMirrorServer();
});
