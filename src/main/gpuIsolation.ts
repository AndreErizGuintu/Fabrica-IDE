import { execFile } from 'child_process';
import path from 'path';
import { app } from 'electron';

// ---------------------------------------------------------------------------
// GPU device isolation for hybrid graphics (Intel iGPU + dedicated GPU), run
// at app startup, before createWindow().
//
// Root cause: when Vulkan enumerates multiple devices, node-llama-cpp's VRAM
// reporting pools them into one figure instead of isolating the dedicated
// card's real free VRAM, so gpuLayers: "auto" wildly overestimates and
// crashes with ErrorOutOfDeviceMemory. Setting GGML_VK_VISIBLE_DEVICES to the
// dedicated GPU's device index fixes VRAM reporting for that device alone --
// CONFIRMED by testing (see DECISIONS.md).
//
// Timing constraint (confirmed by testing, not just theory): setting
// process.env.GGML_VK_VISIBLE_DEVICES mid-process in Electron's main process,
// even before the first getLlama() call, does NOT propagate to the native
// Vulkan backend -- it still sees both devices and pooled VRAM. The var only
// takes effect when it's present in the OS process environment block from the
// moment the process is *created*. So this module runs at app startup and, if
// isolation is needed, sets the var and relaunches the whole app via
// app.relaunch() + app.exit() -- the new process inherits the now-mutated env
// block from creation, which is what actually makes the native backend
// respect it. Model loading itself stays lazy (see llm.ts); only this
// detect-and-maybe-relaunch step needs to happen this early.
const IGPU_NAME_PATTERN = /intel|uhd|iris|graphics/i;
const DEDICATED_VENDOR_PATTERN = /nvidia|geforce|rtx|gtx|quadro|amd|radeon/i;

// NOTE: this exact name-pattern classification (and the probe-script string
// below) is intentionally duplicated in scripts/resolve-gpu-isolation.mjs,
// which runs the same decision under plain Node *before* Electron/electronmon
// start (this file can't be imported there -- it pulls in 'electron', which
// only resolves inside the Electron binary). If you change the classification
// rule or the probe command here, mirror the change in that script too.
//
// Known misclassification risks with this name-based heuristic:
// - AMD APU integrated graphics (e.g. "AMD Radeon(TM) Graphics") contain both
//   an iGPU-signature word ("Graphics") AND a dedicated-vendor word
//   ("Radeon"), so they're treated as a dedicated-GPU candidate. On an AMD
//   laptop with an AMD iGPU + NVIDIA dedicated GPU, both devices would look
//   "non-iGPU" to this pattern, making detection ambiguous (2 candidates) —
//   which correctly falls through to "skip isolation" rather than guessing,
//   but doesn't fix the AMD-iGPU+NVIDIA-dGPU case specifically.
// - Intel Arc dedicated GPUs (e.g. "Intel Arc A770") contain "Intel" with no
//   NVIDIA/AMD/Radeon/GeForce brand word, so they'd be wrongly excluded as an
//   iGPU. Uncommon on budget/mid-range student laptops, but a known gap.
const looksLikeIntegratedGpu = (name: string): boolean =>
  IGPU_NAME_PATTERN.test(name) && !DEDICATED_VENDOR_PATTERN.test(name);

// 40s: first probe after a cold boot/restart genuinely needs this long for
// Vulkan device enumeration alone (confirmed via err.killed/err.signal -- a
// timeout kill, not a driver crash -- the original 15s was just too tight for
// first-run cold-start overhead; see DECISIONS.md). Every subsequent probe in
// the same session finishes in well under a second. Keep in sync with
// scripts/resolve-gpu-isolation.mjs's PROBE_TIMEOUT_MS per the duplication
// note above.
const PROBE_TIMEOUT_MS = 40000;

const probeGpuDeviceNamesOnce = (): Promise<string[]> => new Promise((resolve, reject) => {
  const probeScript = [
    "import('node-llama-cpp').then(async ({ getLlama }) => {",
    '  const llama = await getLlama();',
    '  const names = await llama.getGpuDeviceNames();',
    '  process.stdout.write(JSON.stringify(names));',
    '  await llama.dispose();',
    '  process.exit(0);',
    "}).catch((err) => { process.stderr.write(String((err && err.stack) || err)); process.exit(1); });",
  ].join('\n');

  // Enumerate with ALL devices visible, regardless of anything set on the
  // parent process's env (there shouldn't be anything yet, but be explicit).
  const { GGML_VK_VISIBLE_DEVICES: _ignored, ...probeEnv } = process.env;

  execFile(
    process.execPath,
    ['-e', probeScript],
    {
      cwd: path.dirname(process.execPath),
      timeout: PROBE_TIMEOUT_MS,
      env: { ...probeEnv, ELECTRON_RUN_AS_NODE: '1' },
    },
    (err, stdout, stderr) => {
      if (err) {
        const probeErr = new Error(
          `GPU device probe failed: exitCode=${(err as any).code ?? 'null'} `
          + `killed=${(err as any).killed ?? 'false'} signal=${(err as any).signal ?? 'none'} `
          + `errno=${(err as any).errno ?? 'n/a'} syscall=${(err as any).syscall ?? 'n/a'}\n`
          + `stdout: ${stdout || '(empty)'}\n`
          + `stderr: ${stderr || '(empty)'}\n`
          + `spawn error message: ${err.message}`,
        );
        (probeErr as any).cause = err;
        reject(probeErr);
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        reject(new Error(`GPU device probe returned unparsable output. stdout: ${stdout || '(empty)'} stderr: ${stderr || '(empty)'}`));
      }
    },
  );
});

// Secondary safety net only -- the timeout bump above is the real fix. One
// retry in case even 40s isn't enough on a particularly slow first run.
const probeGpuDeviceNames = async (): Promise<string[]> => {
  try {
    return await probeGpuDeviceNamesOnce();
  } catch (err) {
    console.warn(
      '[gpu-isolation] First probe attempt failed, retrying once:',
      err instanceof Error ? err.message : String(err),
    );
    return probeGpuDeviceNamesOnce();
  }
};

/**
 * Call once, at app startup, before createWindow(). If this process is a
 * relaunch that already carries GGML_VK_VISIBLE_DEVICES, it's a fast no-op.
 * Otherwise it probes for GPU devices and, if a dedicated GPU can be
 * unambiguously identified alongside an iGPU, sets the env var and relaunches
 * the app so the new process picks it up from creation. Never returns
 * normally in that case (app.exit() terminates the process).
 */
export const ensureGpuDeviceIsolation = async (): Promise<void> => {
  // Loop-guard: this is the branch the relaunched process takes. In dev,
  // GGML_VK_VISIBLE_DEVICES is normally already set by the time this runs --
  // resolved once by scripts/resolve-gpu-isolation.mjs before electronmon/
  // Electron ever launched, and inherited down through the npm/webpack spawn
  // chain -- so this returns immediately, no probe/relaunch on every hot
  // reload. Packaged builds have no such pre-start chain to hook into, so
  // they still take the probe+relaunch path below, once, at cold start (a
  // packaged app is a single long-lived process -- not a hot-reload concern).
  // It's also the only thing standing between us and a relaunch loop, so it
  // gets a log line every time it fires -- if a loop ever happened, this line
  // repeating rapidly in the log would make it obvious immediately instead of
  // the app silently spinning.
  if (process.env.GGML_VK_VISIBLE_DEVICES) {
    console.log(`[gpu-isolation] GGML_VK_VISIBLE_DEVICES already set (${process.env.GGML_VK_VISIBLE_DEVICES}), skipping isolation probe.`);
    return;
  }

  let deviceNames: string[];
  try {
    deviceNames = await probeGpuDeviceNames();
  } catch (err) {
    console.warn('[gpu-isolation] GPU device probe failed; skipping device isolation, relying on gpuLayers fallback instead.');
    console.warn('[gpu-isolation]   err.message:', err instanceof Error ? err.message : String(err));
    console.warn('[gpu-isolation]   err.stack:', err instanceof Error ? err.stack : '(no stack)');
    return;
  }

  console.log('[gpu-isolation] Detected GPU device(s):', deviceNames);

  if (deviceNames.length <= 1) {
    console.log('[gpu-isolation] Single (or no) GPU device detected; no isolation needed.');
    return;
  }

  const dedicatedCandidates = deviceNames
    .map((name, index) => ({ name, index }))
    .filter(({ name }) => !looksLikeIntegratedGpu(name));

  if (dedicatedCandidates.length !== 1) {
    console.warn(
      `[gpu-isolation] Could not unambiguously identify the dedicated GPU among [${deviceNames.join(', ')}] ` +
      `(${dedicatedCandidates.length} non-iGPU-looking candidate(s)). Skipping device isolation; ` +
      'relying on the gpuLayers step-down retry as a fallback.',
    );
    return;
  }

  const chosen = dedicatedCandidates[0];
  process.env.GGML_VK_VISIBLE_DEVICES = String(chosen.index);
  console.log(
    `[gpu-isolation] Isolating Vulkan to device #${chosen.index} ("${chosen.name}") via GGML_VK_VISIBLE_DEVICES. ` +
    'Relaunching so the new process inherits this from creation (required -- setting it mid-process does not work).',
  );

  app.relaunch();
  app.exit(0);
};
