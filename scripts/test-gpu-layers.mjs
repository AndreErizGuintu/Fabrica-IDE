import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const layers = process.argv[2] ? parseInt(process.argv[2], 10) : 'auto';
const { modelFile } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'modelConfig.json'), 'utf8'));
const modelPath = path.join(__dirname, '..', 'resources', 'models', modelFile);

const { getLlama, LlamaChatSession } = await import('node-llama-cpp');

console.log(`--- Testing GPU_LAYERS=${layers} ---`);
const llama = await getLlama();
const model = await llama.loadModel({ modelPath, gpuLayers: layers });
const context = await model.createContext();
const session = new LlamaChatSession({ contextSequence: context.getSequence() });
const result = await session.prompt('Say OK');
console.log('RESULT:', result);
process.exit(0);
