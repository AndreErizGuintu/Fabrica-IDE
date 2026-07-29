import fs from 'fs';
import path from 'path';
import { app } from 'electron';

const MODEL_FILE = 'deepseek-coder-6.7b-instruct.Q4_K_M.gguf';
export const GPU_LAYERS: number = parseInt(process.env.GPU_LAYERS || '0', 13);

type LlamaRuntime = {
  llama: unknown;
  model: {
    createContext: () => Promise<{
      getSequence: () => unknown;
      dispose: () => Promise<void>;
    }>;
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

export const initLlama = async (): Promise<LlamaRuntime> => {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const { getLlama, LlamaChatSession: SessionCtor } = await importNodeLlamaCpp();
      const modelPath = getModelPath();
      const llama = await getLlama();
      const model = await llama.loadModel({
        modelPath,
        gpuLayers: GPU_LAYERS,
      });

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
): Promise<string> => {
  const { model } = await initLlama();
  const { LlamaChatSession: SessionCtor } = await importNodeLlamaCpp();
  const context = await model.createContext();

  try {
    const session = new SessionCtor({
      contextSequence: context.getSequence(),
    });

    return await session.prompt(prompt, {
      systemPrompt,
      onTextChunk,
    });
  } finally {
    await context.dispose();
  }
};
