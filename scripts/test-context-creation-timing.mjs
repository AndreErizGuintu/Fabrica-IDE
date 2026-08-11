// scripts/test-context-creation-timing.mjs
// Standalone probe (plain Node, NOT Electron): is per-call createContext() a
// recurring multi-second cost, or a one-time cold-GPU allocation?
// Mirrors llm.ts's real sequence: loadModel -> probe context (auto) + dispose
// [loadModelWithFallback:101-102] -> generate()'s own context + dispose, twice.
// Also runs a 50ms JS heartbeat to see whether the stall is on the JS thread
// (same technique as the HEARTBEAT_DEBUG probe in main.ts).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const layers = process.argv[2] && process.argv[2] !== 'auto' ? parseInt(process.argv[2], 10) : 'auto';
const ctxArg = process.argv[3] ?? '1024';
const contextSize = ctxArg === 'auto' ? undefined : parseInt(ctxArg, 10);

const { modelFile } = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'modelConfig.json'), 'utf8'),
);
const modelPath = path.join(__dirname, '..', 'resources', 'models', modelFile);

// --- JS event-loop heartbeat -------------------------------------------------
let lastTick = performance.now();
let maxGap = 0;
let gapsOver500 = [];
let phase = 'startup';
const heartbeat = setInterval(() => {
  const now = performance.now();
  const gap = now - lastTick;
  lastTick = now;
  if (gap > maxGap) maxGap = gap;
  if (gap > 500) gapsOver500.push({ phase, gap: Math.round(gap) });
}, 50);
heartbeat.unref?.();

const resetHeartbeat = (name) => {
  phase = name;
  lastTick = performance.now();
  maxGap = 0;
  gapsOver500 = [];
};
const heartbeatReport = () =>
  `maxJsLoopGap=${Math.round(maxGap)}ms` +
  (gapsOver500.length ? ` stalls>500ms=[${gapsOver500.map((g) => g.gap).join(', ')}]` : ' stalls>500ms=none');

const ms = (t) => `${Math.round(t)}ms`;

// --- run ---------------------------------------------------------------------
const { getLlama } = await import('node-llama-cpp');

console.log(`--- context-creation timing | GPU_LAYERS=${layers} contextSize=${contextSize ?? 'auto'} ---\n`);

resetHeartbeat('getLlama');
let t = performance.now();
const llama = await getLlama();
console.log(`getLlama():          ${ms(performance.now() - t)}   ${heartbeatReport()}`);

resetHeartbeat('loadModel');
t = performance.now();
const model = await llama.loadModel({ modelPath, gpuLayers: layers });
console.log(`loadModel():         ${ms(performance.now() - t)}   ${heartbeatReport()}`);

// Mirrors llm.ts loadModelWithFallback's validation probe (contextSize: auto).
resetHeartbeat('probe-create');
t = performance.now();
const probe = await model.createContext();
const probeCreate = performance.now() - t;
console.log(`\n[probe] createContext(auto): ${ms(probeCreate)}   ${heartbeatReport()}`);
resetHeartbeat('probe-dispose');
t = performance.now();
await probe.dispose();
console.log(`[probe] dispose():           ${ms(performance.now() - t)}   ${heartbeatReport()}`);

// Two back-to-back cycles matching what generate() does per call.
const results = [];
for (const cycle of [1, 2]) {
  resetHeartbeat(`cycle${cycle}-create`);
  t = performance.now();
  const context = contextSize ? await model.createContext({ contextSize }) : await model.createContext();
  const createMs = performance.now() - t;
  const createHb = heartbeatReport();

  resetHeartbeat(`cycle${cycle}-getSequence`);
  t = performance.now();
  context.getSequence();
  const seqMs = performance.now() - t;
  const seqHb = heartbeatReport();

  resetHeartbeat(`cycle${cycle}-dispose`);
  t = performance.now();
  await context.dispose();
  const disposeMs = performance.now() - t;
  const disposeHb = heartbeatReport();

  results.push({ cycle, createMs, seqMs, disposeMs });
  console.log(`\n=== cycle ${cycle} (actual context size ${contextSize ?? 'auto'}) ===`);
  console.log(`  createContext(): ${ms(createMs)}   ${createHb}`);
  console.log(`  getSequence():   ${ms(seqMs)}   ${seqHb}`);
  console.log(`  dispose():       ${ms(disposeMs)}   ${disposeHb}`);
  console.log(`  cycle total:     ${ms(createMs + seqMs + disposeMs)}`);
}

const [c1, c2] = results;
const delta = c2.createMs - c1.createMs;
const pct = (delta / c1.createMs) * 100;
console.log(`\n--- verdict ---`);
console.log(`cycle1 createContext = ${ms(c1.createMs)}, cycle2 createContext = ${ms(c2.createMs)}`);
console.log(`delta = ${delta >= 0 ? '+' : ''}${Math.round(delta)}ms (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`);
console.log(
  c2.createMs > c1.createMs * 0.6
    ? 'RECURRING: cycle 2 is not meaningfully cheaper -> per-call context creation is a permanent cost.'
    : 'COLD-START: cycle 2 is much cheaper -> cycle 1 was dominated by one-time allocation.',
);

clearInterval(heartbeat);
process.exit(0);
