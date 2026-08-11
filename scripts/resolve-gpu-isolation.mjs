import { execFile, spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Duplicated from src/main/gpuIsolation.ts (see the comment there) -- this
// runs under plain Node before Electron exists, so it can't import that file
// directly (it pulls in 'electron'). Keep this in sync with gpuIsolation.ts
// if the classification rule or probe command ever changes.
const IGPU_NAME_PATTERN = /intel|uhd|iris|graphics/i;
const DEDICATED_VENDOR_PATTERN = /nvidia|geforce|rtx|gtx|quadro|amd|radeon/i;
const looksLikeIntegratedGpu = (name) =>
  IGPU_NAME_PATTERN.test(name) && !DEDICATED_VENDOR_PATTERN.test(name);

const resolveIsolatedDeviceIndex = (deviceNames) => {
  if (deviceNames.length <= 1) return null;
  const dedicatedCandidates = deviceNames
    .map((name, index) => ({ name, index }))
    .filter(({ name }) => !looksLikeIntegratedGpu(name));
  return dedicatedCandidates.length === 1 ? dedicatedCandidates[0].index : null;
};

// 40s: first probe after a cold boot/restart genuinely needs this long for
// Vulkan device enumeration alone (confirmed via err.killed/err.signal -- a
// timeout kill, not a driver crash -- the original 15s was just too tight for
// first-run cold-start overhead; see DECISIONS.md). Every subsequent probe in
// the same session finishes in well under a second.
const PROBE_TIMEOUT_MS = 40000;

const probeGpuDeviceNamesOnce = () => new Promise((resolve, reject) => {
  const probeScript = [
    "import('node-llama-cpp').then(async ({ getLlama }) => {",
    '  const llama = await getLlama();',
    '  const names = await llama.getGpuDeviceNames();',
    '  process.stdout.write(JSON.stringify(names));',
    '  await llama.dispose();',
    '  process.exit(0);',
    "}).catch((err) => { process.stderr.write(String((err && err.stack) || err)); process.exit(1); });",
  ].join('\n');

  execFile(
    process.execPath,
    ['-e', probeScript],
    { cwd: path.join(__dirname, '..'), timeout: PROBE_TIMEOUT_MS },
    (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`GPU probe failed: ${err.message}\nstdout: ${stdout || '(empty)'}\nstderr: ${stderr || '(empty)'}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        reject(new Error(`GPU probe returned unparsable output: ${stdout}`));
      }
    },
  );
});

// Secondary safety net only -- the timeout bump above is the real fix. One
// retry in case even 40s isn't enough on a particularly slow first run.
const probeGpuDeviceNames = async () => {
  try {
    return await probeGpuDeviceNamesOnce();
  } catch (err) {
    console.warn('[resolve-gpu-isolation] First probe attempt failed, retrying once:', err.message);
    return probeGpuDeviceNamesOnce();
  }
};

// Best-effort only: ANY failure here (probe crash, timeout, ambiguous
// devices) falls through to {} -- i.e. start:renderer still launches with
// unmodified env, and gpuIsolation.ts's runtime relaunch path picks up the
// slack exactly as it did before this script existed. This step must never
// be able to block `npm start` from booting.
const resolveExtraEnv = async () => {
  try {
    const deviceNames = await probeGpuDeviceNames();
    console.log('[resolve-gpu-isolation] Detected GPU device(s):', deviceNames);
    const index = resolveIsolatedDeviceIndex(deviceNames);
    if (index === null) {
      console.log('[resolve-gpu-isolation] No unambiguous dedicated GPU; starting without pre-set isolation.');
      return {};
    }
    console.log(`[resolve-gpu-isolation] Isolating Vulkan to device #${index} ("${deviceNames[index]}").`);
    return { GGML_VK_VISIBLE_DEVICES: String(index) };
  } catch (err) {
    console.warn('[resolve-gpu-isolation] GPU probe failed, starting without isolation:', err.message);
    return {};
  }
};

const extraEnv = await resolveExtraEnv();

spawn('npm', ['run', 'start:renderer'], {
  shell: true,
  stdio: 'inherit',
  env: { ...process.env, ...extraEnv },
}).on('close', (code) => process.exit(code ?? 0))
  .on('error', (err) => {
    console.error('[resolve-gpu-isolation] Failed to launch start:renderer:', err);
    process.exit(1);
  });
