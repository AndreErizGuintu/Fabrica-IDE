// Custom Node ESM loader used only by scripts/test-adaptive-engine.mjs.
//
// adaptiveEngine.ts is written to run inside Electron's main process
// (webpack + ts-node handle module resolution/transpilation there). Loading
// it directly under plain `node` for standalone testing hits two gaps that
// don't exist in the Electron build:
//   1. Extensionless relative imports ('./llm', './stats') — webpack
//      resolves these; plain Node ESM requires an explicit extension.
//   2. `import { app } from 'electron'` — the real 'electron' package isn't
//      a functional module outside the Electron runtime.
//
// This loader is test-harness-only. It does not touch adaptiveEngine.ts's
// trigger logic, and llm.ts/stats.ts are otherwise imported and run for
// real (untouched) — only the 'electron' specifier itself is stubbed, since
// nothing this test exercises calls into app.getPath() etc. (that only
// happens inside requestHint()/incrementAiCallCount(), which this test
// harness never calls).
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

//   3. `import { GenerationPriority } from './worker/llmProtocol'` inside
//      llm.ts — that is a TYPE-only export imported without `import type`.
//      webpack/ts-loader erases it; plain Node's type-stripping cannot, so the
//      module fails to instantiate. This predates Scenario 5 and is reproducible
//      on a clean checkout at HEAD. Stubbing './llm' sidesteps it without
//      touching production code: this harness never calls generate()/
//      requestHint(), so the real module is not needed to exercise triggers.
const ELECTRON_STUB_URL = 'adaptive-engine-test:electron-stub';
const LLM_STUB_URL = 'adaptive-engine-test:llm-stub';

const LLM_STUB_SOURCE = `
export async function generate() {
  throw new Error('llm.generate() is stubbed in the adaptive-engine test harness');
}
export function shutdownWorker() {}
export default { generate, shutdownWorker };
`;

const ELECTRON_STUB_SOURCE = `
export const app = {
  getPath: () => '',
  getAppPath: () => '',
  isPackaged: false,
  setName: () => {},
  relaunch: () => {},
  exit: () => {},
};
export default { app };
`;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: ELECTRON_STUB_URL, shortCircuit: true };
  }

  if (specifier === './llm' || specifier === './llm.ts') {
    return { url: LLM_STUB_URL, shortCircuit: true };
  }

  if (specifier.startsWith('.') && !/\.[a-zA-Z0-9]+$/.test(specifier)) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(candidate))) {
      return nextResolve(`${specifier}.ts`, context);
    }
  }

  const result = await nextResolve(specifier, context);

  // Node ESM requires an explicit `type: "json"` import attribute for JSON
  // modules; adaptiveEngine.ts (written for webpack, which needs none)
  // doesn't have one, so inject it here rather than editing the source.
  if (specifier.endsWith('.json')) {
    return { ...result, importAttributes: { ...result.importAttributes, type: 'json' } };
  }

  return result;
}

export async function load(url, context, nextLoad) {
  if (url === ELECTRON_STUB_URL) {
    return { format: 'module', source: ELECTRON_STUB_SOURCE, shortCircuit: true };
  }
  if (url === LLM_STUB_URL) {
    return { format: 'module', source: LLM_STUB_SOURCE, shortCircuit: true };
  }
  return nextLoad(url, context);
}
