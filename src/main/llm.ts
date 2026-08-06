import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import modelConfig from './modelConfig.json';

// Single swap point: change modelFile in src/main/modelConfig.json and drop the new
// .gguf into resources/models/ to switch models. scripts/benchmark.mjs and
// scripts/test-gpu-layers.mjs read the same file, so this is the only place to edit.
const MODEL_FILE = modelConfig.modelFile;

// "auto" adapts layer count to available VRAM at load time (see node-llama-cpp's
// LlamaModelOptions.gpuLayers docs). Set GPU_LAYERS env var to override with a fixed count.
export const GPU_LAYERS: number | 'auto' = process.env.GPU_LAYERS
  ? parseInt(process.env.GPU_LAYERS, 10)
  : 'auto';

// Used as a safety net under gpuLayers "auto"/an explicit override: if loading at the
// requested layer count fails with a VRAM error, step down through this ladder (only
// values below the starting point are tried) until something fits.
const GPU_LAYERS_FALLBACK_LADDER = [20, 13, 8, 4, 0];
const MAX_LOAD_ATTEMPTS = 6;

const VRAM_ERROR_PATTERNS = [
  /ErrorOutOfDeviceMemory/i,
  /out of device memory/i,
  /failed to allocate .*buffer/i,
  /failed to create context/i,
  /insufficient.*memory/i,
];

const isVramError = (err: unknown): boolean => {
  const message = err instanceof Error ? err.message : String(err);
  return VRAM_ERROR_PATTERNS.some((pattern) => pattern.test(message));
};

type LlamaRuntime = {
  llama: unknown;
  model: {
    createContext: (options?: { contextSize?: number }) => Promise<{
      getSequence: () => unknown;
      dispose: () => Promise<void>;
    }>;
    dispose: () => Promise<void>;
  };
};

let runtimePromise: Promise<LlamaRuntime> | null = null;

const importNodeLlamaCpp = () => {
  const dynamicImport = new Function('moduleName', 'return import(moduleName)') as
    (moduleName: string) => Promise<{ getLlama: () => Promise<any>; LlamaChatSession: new (...args: any[]) => any }>;
  return dynamicImport('node-llama-cpp');
};

const getModelPath = () => {
  const modelPath = app.isPackaged
    ? path.join(process.resourcesPath, 'models', MODEL_FILE)
    : path.join(app.getAppPath(), 'resources', 'models', MODEL_FILE);

  if (!fs.existsSync(modelPath)) {
    throw new Error(`Model file not found. Expected at: ${modelPath}`);
  }

  return modelPath;
};

// ---------------------------------------------------------------------------
// gpuLayers step-down retry: a safety net under GPU device isolation (see
// gpuIsolation.ts, run at app startup before this module is ever used), in
// case isolation was skipped (ambiguous/no GPU) or the isolated device still
// doesn't have enough VRAM for the requested/auto-resolved layer count.
const buildLayerAttempts = (): (number | 'auto')[] => {
  const start = GPU_LAYERS;
  const ladder = GPU_LAYERS_FALLBACK_LADDER.filter((n) => start === 'auto' || n < start);
  const attempts: (number | 'auto')[] = [start, ...ladder];
  return attempts.slice(0, MAX_LOAD_ATTEMPTS);
};

const loadModelWithFallback = async (llama: any, modelPath: string) => {
  const attempts = buildLayerAttempts();
  let lastError: unknown;

  for (let i = 0; i < attempts.length; i += 1) {
    const gpuLayers = attempts[i];
    const isLastAttempt = i === attempts.length - 1;
    let model: any;

    try {
      model = await llama.loadModel({ modelPath, gpuLayers });
    } catch (err) {
      lastError = err;
      if (!isVramError(err) || isLastAttempt) throw err;
      console.warn(`[llm] loadModel failed with gpuLayers=${gpuLayers}: ${(err as Error).message}. Stepping down.`);
      continue;
    }

    // Validate the layer count actually fits by creating (and immediately
    // disposing) a context — KV-cache VRAM is allocated at context creation,
    // not at loadModel time, so a load can "succeed" and still be unusable.
    try {
      const probeContext = await model.createContext();
      await probeContext.dispose();
      console.log(`[llm] Model loaded successfully with gpuLayers=${gpuLayers}.`);
      return model;
    } catch (err) {
      lastError = err;
      await model.dispose();
      if (!isVramError(err) || isLastAttempt) throw err;
      console.warn(`[llm] createContext failed with gpuLayers=${gpuLayers}: ${(err as Error).message}. Stepping down.`);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Model failed to load at every gpuLayers fallback level.');
};

export const initLlama = async (): Promise<LlamaRuntime> => {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const { getLlama } = await importNodeLlamaCpp();
      const modelPath = getModelPath();
      // TEMPORARY DIAGNOSTIC: confirm what the real, process-wide getLlama() call
      // actually sees at the moment it runs.
      console.log('[llm] DIAGNOSTIC: process.env.GGML_VK_VISIBLE_DEVICES immediately before real getLlama() =', JSON.stringify(process.env.GGML_VK_VISIBLE_DEVICES));
      const llama = await getLlama();
      // TEMPORARY DIAGNOSTIC: does the REAL, in-process native Vulkan backend
      // actually honor the filter, or does it still see both devices despite
      // the env var being correctly set (per the logs above)? This isolates
      // "our JS set the var correctly" from "the native layer respected it."
      console.log('[llm] DIAGNOSTIC: llama.getGpuDeviceNames() after real getLlama() =', await llama.getGpuDeviceNames());
      console.log('[llm] DIAGNOSTIC: llama.getVramState() after real getLlama() =', await llama.getVramState());
      const model = await loadModelWithFallback(llama, modelPath);

      return { llama, model };
    })().catch((err) => {
      runtimePromise = null;
      throw err;
    });
  }

  return runtimePromise;
};

export const generate = async (
  prompt: string,
  systemPrompt?: string,
  onTextChunk?: (text: string) => void,
  options?: { maxTokens?: number; contextSize?: number },
): Promise<string> => {
  const { llama, model } = await initLlama();
  console.log('[llm] generate() using GPU device(s):', await (llama as any).getGpuDeviceNames());
  const { LlamaChatSession: SessionCtor } = await importNodeLlamaCpp();
  const context = options?.contextSize
    ? await model.createContext({ contextSize: options.contextSize })
    : await model.createContext();

  try {
    const session = new SessionCtor({
      contextSequence: context.getSequence(),
    });

    return await session.prompt(prompt, {
      systemPrompt,
      onTextChunk,
      maxTokens: options?.maxTokens,
    });
  } finally {
    await context.dispose();
  }
};
