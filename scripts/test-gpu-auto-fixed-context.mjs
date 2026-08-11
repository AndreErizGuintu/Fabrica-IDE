import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contextSize = parseInt(process.argv[2] ?? '4096', 10);
const { modelFile } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'modelConfig.json'), 'utf8'));
const modelPath = path.join(__dirname, '..', 'resources', 'models', modelFile);

const { getLlama, LlamaChatSession } = await import('node-llama-cpp');

console.log(`--- Testing gpuLayers: "auto" with fixed contextSize: ${contextSize} ---`);
const llama = await getLlama();
const model = await llama.loadModel({ modelPath, gpuLayers: 'auto' });
console.log(`Model loaded. Resolved gpuLayers: ${model.gpuLayers}`);

const context = await model.createContext({ contextSize });
console.log(`Context created. Actual contextSize: ${context.contextSize}`);

const session = new LlamaChatSession({ contextSequence: context.getSequence() });
const result = await session.prompt('Say OK');
console.log('RESULT:', result);

await context.dispose();
process.exit(0);
