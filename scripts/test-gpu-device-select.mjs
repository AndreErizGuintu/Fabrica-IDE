import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// GGML_VK_VISIBLE_DEVICES is read by llama.cpp's native Vulkan backend, not by
// node-llama-cpp's own JS options (no such option exists there — see report).
// Must be set before the native module initializes Vulkan, so set it here before import.
const deviceIndex = process.argv[2] ?? process.env.GGML_VK_VISIBLE_DEVICES;
if (deviceIndex != null) {
  process.env.GGML_VK_VISIBLE_DEVICES = String(deviceIndex);
}

const { modelFile } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'modelConfig.json'), 'utf8'));
const modelPath = path.join(__dirname, '..', 'resources', 'models', modelFile);

const { getLlama, LlamaChatSession } = await import('node-llama-cpp');

console.log(`--- GGML_VK_VISIBLE_DEVICES=${process.env.GGML_VK_VISIBLE_DEVICES ?? '(not set — all devices visible)'} ---`);

const llama = await getLlama();
console.log('Visible GPU device names:', await llama.getGpuDeviceNames());
console.log('VRAM state:', await llama.getVramState());

const model = await llama.loadModel({ modelPath, gpuLayers: 'auto' });
console.log(`Model loaded. Resolved gpuLayers: ${model.gpuLayers}`);

const context = await model.createContext();
console.log(`Context created. Actual contextSize: ${context.contextSize}`);

const session = new LlamaChatSession({ contextSequence: context.getSequence() });
const result = await session.prompt('Say OK');
console.log('RESULT:', result);

await context.dispose();
process.exit(0);
