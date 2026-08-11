import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const layers = process.argv[2] ? parseInt(process.argv[2], 10) : 'auto';
const { modelFile } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'modelConfig.json'), 'utf8'));
const modelPath = path.join(__dirname, '..', 'resources', 'models', modelFile);

const { getLlama, LlamaChatSession } = await import('node-llama-cpp');

const prompts = [
  'Write a JS function that adds two numbers',
  'Explain what a for loop does in simple terms',
  'Fix this code: function add(a, b) { retun a + b }',
];

console.log(`--- Benchmarking GPU_LAYERS=${layers} ---`);

const bootStart = performance.now();
const llama = await getLlama();
const model = await llama.loadModel({ modelPath, gpuLayers: layers });
const bootTime = (performance.now() - bootStart) / 1000;
console.log(`\nModel boot/load time (cold start): ${bootTime.toFixed(2)}s\n`);

for (const prompt of prompts) {
  const context = await model.createContext();
  const session = new LlamaChatSession({ contextSequence: context.getSequence() });
  const start = performance.now();
  const result = await session.prompt(prompt);
  const elapsed = (performance.now() - start) / 1000;
  console.log(`Prompt: "${prompt}"`);
  console.log(`Time: ${elapsed.toFixed(2)}s`);
  console.log(`Response: ${result.slice(0, 150)}...\n`);
  await context.dispose();
}
process.exit(0);
