// ===========================================================================
// Inference utility process -- the model half of `llm.ts`, split out on
// 2026-08-09 as PART 1 of the utility-process migration (DECISIONS.md
// 2026-08-07 section 5, work item 2).
//
// This file is EVERYTHING that used to live in `llm.ts` except the two things
// that require Electron's main process: `import { app } from 'electron'` and
// `getModelPath()`'s `app.isPackaged` / `app.getAppPath()` branch. Those stay
// in `llm.ts`, which resolves the absolute model path and hands it here as a
// `--model-path=` fork argument. Per DECISIONS.md section 2 that is deliberate
// and not a workaround: a utility process only guarantees a Node environment
// plus `process.parentPort`, so relying on `app` being reachable here would be
// building on an assumption for no benefit.
//
// NOTHING IN THIS FILE MAY IMPORT 'electron'. That invariant is what makes the
// split work. `process.parentPort` is typed locally below rather than pulled
// from Electron's ambient type augmentation, so the rule holds at the type
// level too.
//
// The model load, the gpuLayers step-down ladder, the cached chat-wrapper fix
// (2026-08-09, DECISIONS.md section 8) and the single-flight lock all moved
// here UNCHANGED. The lock lives worker-side on purpose: one owner of the
// model, one owner of its lock (DECISIONS.md section 4).
//
// DIAGNOSTIC LOGGING NOTE: the `[llm]` / `[CodeInference:lock]` /
// `[generate:phase]` prefixes are kept byte-identical to their pre-split
// wording so existing log captures and greps still work.
//
// CORRECTED 2026-08-10: this note used to claim these lines "still land in the
// same dev terminal they always did" because `llm.ts` passed
// `stdio: 'inherit'`. That was wrong -- inherit silently dropped every line in
// this file (confirmed on a run where a generation completed successfully and
// printed nothing). `llm.ts` now forks with `stdio: 'pipe'` and relays both
// streams into main's, which is what actually makes the claim true. Nothing in
// THIS file changed to achieve that; plain `console.log` remains correct here.
// All of it is still slated for removal before defense (tracked in
// DECISIONS.md open flags).
// ===========================================================================

import fs from 'fs';
import modelConfig from '../modelConfig.json';
import {
  GenerationPriority,
  ModelBusyError,
  GenerationAbortedError,
  WorkerRequest,
  WorkerResponse,
  WireGenerateOptions,
  serializeError,
} from './llmProtocol';

// ===========================================================================
// TEMPORARY DIAGNOSTIC: worker boot line -- the FIRST thing this module does.
//
// Its only job is to answer "is worker stdout reaching the terminal at all?"
// on its own, before and independently of anything that could go wrong later
// (model load, GPU init, generation). Prior to the 2026-08-10 stdio fix in
// `llm.ts` the answer was silently no, and it was impossible to tell from a log
// capture: this file printed nothing before `post({ type: 'ready' })`, and the
// `[llm] inference utility process ready` line that looked like proof of life
// is printed by MAIN, not by the worker. That ambiguity is what this line
// removes -- if you can read it, the pipe works.
//
// Emitted on BOTH streams on purpose: stdout carries the `[llm] DIAGNOSTIC:` /
// `[generate:phase]` / `[CodeInference:lock]` output, stderr carries crashes
// and native warnings, and they are relayed separately in `llm.ts`. Two lines
// prove both halves in one run instead of leaving stderr untested until
// something has already gone wrong.
//
// Placement note: this sits immediately after the imports rather than literally
// above them because webpack hoists ESM imports above every other statement
// regardless of source order -- putting it higher would read as first without
// being first. Every import above is side-effect-free (`fs`, a JSON config, and
// type/error definitions); `node-llama-cpp` is loaded lazily inside
// `importNodeLlamaCpp()`, so nothing heavy runs before this.
//
// Remove alongside LOCK_DEBUG / HEARTBEAT_DEBUG before defense.
// ===========================================================================
console.log(
  `[llmWorker] BOOT (stdout): worker module evaluated, pid=${process.pid}. If you can read this, worker stdout is reaching the terminal.`,
);
console.error(
  `[llmWorker] BOOT (stderr): worker module evaluated, pid=${process.pid}. If you can read this, worker stderr is reaching the terminal.`,
);

// Single swap point: change modelFile in src/main/modelConfig.json and drop the new
// .gguf into resources/models/ to switch models. scripts/benchmark.mjs and
// scripts/test-gpu-layers.mjs read the same file, so this is the only place to edit.
// Kept here purely for the error message below -- the path itself is resolved by
// `llm.ts` in the main process and arrives as a fork argument.
const MODEL_FILE = modelConfig.modelFile;

// "auto" adapts layer count to available VRAM at load time (see node-llama-cpp's
// LlamaModelOptions.gpuLayers docs). Set GPU_LAYERS env var to override with a fixed count.
// The worker inherits main's env on fork (llm.ts passes it explicitly), so this
// reads the same value it always did.
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
  // Resolved once per process (see initLlama()) and reused on every
  // generate() call instead of leaving LlamaChatSession's chatWrapper option
  // at its "auto" default, which re-runs a synchronous, zero-yielding
  // brute-force search on every single call. See the 2026-08-09 fix note
  // below, on the phaseLog call that times this resolution.
  chatWrapper: unknown;
};

let runtimePromise: Promise<LlamaRuntime> | null = null;

const importNodeLlamaCpp = () => {
  const dynamicImport = new Function('moduleName', 'return import(moduleName)') as
    (moduleName: string) => Promise<{
      getLlama: () => Promise<any>;
      LlamaChatSession: new (...args: any[]) => any;
      resolveChatWrapper: (model: any) => any;
    }>;
  return dynamicImport('node-llama-cpp');
};

// ---------------------------------------------------------------------------
// Model path arrives from main as a fork argument instead of being resolved
// here, because resolving it needs `app` (see the file header). `argv[0]` is
// the exec path and `argv[1]` is this module, so the fork args start at 2.
const MODEL_PATH_ARG = '--model-path=';

const readModelPathArg = (): string => {
  const arg = process.argv.slice(2).find((a) => a.startsWith(MODEL_PATH_ARG));
  if (!arg) {
    throw new Error(
      `[llmWorker] No ${MODEL_PATH_ARG} fork argument was provided. The main process ` +
        `(llm.ts) is responsible for resolving and passing the absolute path to ${MODEL_FILE}.`,
    );
  }

  const modelPath = arg.slice(MODEL_PATH_ARG.length);
  // main already checks this in getModelPath(); re-checked here so a bad path
  // fails with a clear message from the side that actually opens the file.
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
    // disposing) a context -- KV-cache VRAM is allocated at context creation,
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

// ===========================================================================
// TEMPORARY DIAGNOSTIC LOGGING - added 2026-08-06 to trace why no ghost text
// appears after the model finishes loading. REMOVE, or gate behind a real
// debug setting, once that is diagnosed. Flip this one flag to silence it.
//
// NOTE: this instruments runGeneration() itself, so it logs EVERY caller
// (Ask/Plan/Translate/Explain/Hint as well as Code Inference), not just Code
// Inference. Each line carries its priority so callers can be told apart:
// 'opportunistic' is Code Inference, 'explicit' is everything else.
// ===========================================================================
const LOCK_DEBUG = true;
let generationSeq = 0;

const lockLog = (...args: unknown[]) => {
  if (LOCK_DEBUG) console.log('[CodeInference:lock]', ...args);
};

// ---------------------------------------------------------------------------
// TEMPORARY DIAGNOSTIC: per-phase timing instrumentation, added 2026-08-09 to
// attribute the confirmed 7566ms main-process freeze (DECISIONS.md, 08-07 s7)
// to a named phase by MEASUREMENT, not log position -- log-position guesswork
// is exactly what pointed at createContext() originally, and that attribution
// was disproven under plain Node (DECISIONS.md, 08-09). Reuses LOCK_DEBUG as
// its gate rather than adding a new flag. Each line logs both a hrtime-derived
// duration (precision) and Date.now() start/end (so these lines can be lined
// up directly against [heartbeat]'s own Date.now()-based gap timestamps in the
// same captured run -- note the heartbeat still runs in MAIN, and after this
// split it should tick cleanly straight through every phase logged here).
// initLlama() below calls this with the fixed id 'init' rather than a
// per-request id, since model load is cached process-wide in `runtimePromise`
// and only ever really happens once. Strip alongside LOCK_DEBUG/
// HEARTBEAT_DEBUG before defense.
const hrMs = (startHr: bigint, endHr: bigint) => Number(endHr - startHr) / 1e6;

const phaseLog = (
  id: string,
  phase: string,
  startHr: bigint,
  endHr: bigint,
  startMs: number,
  endMs: number,
) => {
  if (!LOCK_DEBUG) return;
  console.log(
    `[generate:phase] ${id} ${phase} took ${hrMs(startHr, endHr).toFixed(1)}ms (start=${startMs} end=${endMs})`,
  );
};

export const initLlama = async (): Promise<LlamaRuntime> => {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const { getLlama, resolveChatWrapper } = await importNodeLlamaCpp();
      const modelPath = readModelPathArg();
      // TEMPORARY DIAGNOSTIC: confirm what the real, process-wide getLlama() call
      // actually sees at the moment it runs.
      //
      // MIGRATION NOTE (DECISIONS.md section 3): this and the two device
      // diagnostics below are the EXISTING probes, deliberately reused rather
      // than rewritten. They are now the check for the one thing section 3 said
      // to verify empirically rather than assume -- that a FORKED worker
      // genuinely sees only the isolated device. The "env var must be present at
      // process creation" constraint was established for the Electron main
      // process; `utilityProcess.fork()` is a process creation with an env block
      // main controls, so it should hold, but it is unverified until this line
      // is read off a real run.
      console.log('[llm] DIAGNOSTIC: process.env.GGML_VK_VISIBLE_DEVICES immediately before real getLlama() =', JSON.stringify(process.env.GGML_VK_VISIBLE_DEVICES));
      const getLlamaStartHr = process.hrtime.bigint();
      const getLlamaStartMs = Date.now();
      const llama = await getLlama();
      phaseLog('init', 'getLlama()', getLlamaStartHr, process.hrtime.bigint(), getLlamaStartMs, Date.now());
      // TEMPORARY DIAGNOSTIC: does the REAL, in-process native Vulkan backend
      // actually honor the filter, or does it still see both devices despite
      // the env var being correctly set (per the logs above)? This isolates
      // "our JS set the var correctly" from "the native layer respected it."
      const diagnosticsStartHr = process.hrtime.bigint();
      const diagnosticsStartMs = Date.now();
      console.log('[llm] DIAGNOSTIC: llama.getGpuDeviceNames() after real getLlama() =', await llama.getGpuDeviceNames());
      console.log('[llm] DIAGNOSTIC: llama.getVramState() after real getLlama() =', await llama.getVramState());
      phaseLog('init', 'diagnostics (getGpuDeviceNames+getVramState)', diagnosticsStartHr, process.hrtime.bigint(), diagnosticsStartMs, Date.now());
      const loadModelStartHr = process.hrtime.bigint();
      const loadModelStartMs = Date.now();
      const model = await loadModelWithFallback(llama, modelPath);
      phaseLog('init', 'loadModelWithFallback()', loadModelStartHr, process.hrtime.bigint(), loadModelStartMs, Date.now());

      // FIX 2026-08-09: resolve the chat wrapper ONCE per process instead of
      // leaving runGeneration()'s SessionCtor call at chatWrapper's "auto"
      // default. "auto" triggers resolveChatWrapper() -> a synchronous,
      // zero-yielding brute-force search across all 16 built-in wrapper types x
      // up to 4 settings variants, actually compiling and rendering a real
      // JinjaTemplateChatWrapper against canned test histories for each
      // candidate -- confirmed via session.log phase timing + heartbeat
      // cross-reference as the dominant main-process freeze (~2.9-3.1s,
      // matched 3/3 generations to heartbeat gaps within ~15-35ms), not
      // createContext() as originally (and incorrectly) attributed by log
      // position. Safe to cache: resolveChatWrapper(model) is a pure function
      // of the model's static GGUF metadata (chat_template, filename,
      // tokenizer) -- nothing about it depends on conversation history or any
      // other per-call state, so it returns the same wrapper every time for a
      // given loaded model. This is orthogonal to the 07-28 fresh-session-
      // per-call fix: that fix addressed conversation HISTORY bleeding across
      // calls; chatWrapper is stateless formatting logic, not history, so
      // caching it cannot reintroduce that bug. See DECISIONS.md 2026-08-09.
      //
      // KEPT AS-IS THROUGH THE SPLIT. It is now belt-and-braces rather than
      // load-bearing for the freeze -- this cost no longer lands on main's
      // event loop at all -- but it is still a real ~2.9s saving per warm
      // generation, so removing it would make every call slower for nothing.
      const resolveWrapperStartHr = process.hrtime.bigint();
      const resolveWrapperStartMs = Date.now();
      const chatWrapper = resolveChatWrapper(model);
      phaseLog('init', 'resolveChatWrapper() (cached for the rest of the process)', resolveWrapperStartHr, process.hrtime.bigint(), resolveWrapperStartMs, Date.now());

      return { llama, model, chatWrapper };
    })().catch((err) => {
      runtimePromise = null;
      throw err;
    });
  }

  return runtimePromise;
};

// ---------------------------------------------------------------------------
// Single-flight generation lock.
//
// THERE WAS NO CONCURRENCY HANDLING HERE BEFORE THIS. Every caller of
// generate() independently created its own context on the shared model and
// prompted it. That was never exercised because every existing caller is
// user-initiated and mutually exclusive in the UI (Ask/Plan/Translate/Explain
// are one panel, and the Scenario 3 hint only fires on an explicit accept) --
// so two generations could not realistically overlap. The lock was added when
// Code Inference looked like it would be the first PASSIVE caller. It is worth
// keeping now that Code Inference is accept-gated too: it is a second
// accept-driven entry point OUTSIDE the AI panel, so a student can start a
// completion and an Ask in quick succession, and two live contexts on a
// single-model 6GB-VRAM setup is a real OOM risk rather than a theoretical one.
//
// Policy:
//   'explicit'      - user-initiated (Ask/Plan/Translate/Explain/Hint/Code
//                     Inference). Waits its turn, and cancels any in-flight
//                     'opportunistic' generation first. Explicit user actions
//                     always win over passive ones.
//   'opportunistic' - passive/background. NEVER queues and NEVER blocks: if
//                     anything is already generating it fails fast with
//                     ModelBusyError so the caller can silently skip.
//
// UPDATE 2026-08-07: 'opportunistic' CURRENTLY HAS NO CALLERS. Code Inference
// was the only one, and its pivot to a confirmation-based flow reclassified it
// as 'explicit' -- a student who clicks "Complete it" must not have their
// request dropped just because the AI panel is mid-generation. The priority
// machinery is kept rather than deleted because the OTHER half of this lock is
// still load-bearing: two 'explicit' callers serialize behind each other
// instead of putting two live contexts on a 6GB single-model setup at once.
// Ripping out the opportunistic branch would mean editing that serialization
// for no behavioral gain. Flagged in DECISIONS.md as removable if no passive
// caller ever returns.
//
// UPDATE 2026-08-09 (utility-process split): the lock moved here WHOLESALE and
// unmodified. It now serializes requests arriving over the MessagePort instead
// of direct in-process calls, which changes nothing about its logic -- but it
// is worth stating that the lock is now the ONLY serialization point, and it
// is on the correct side of the boundary: the process that owns the model owns
// its lock (DECISIONS.md section 4). `isModelBusy()` intentionally did NOT come
// along; main cannot answer it synchronously any more, and it had zero callers.
type InFlightGeneration = {
  priority: GenerationPriority;
  abort: () => void;
  // Resolves (never rejects) once the slot is free, so a waiter can't inherit
  // the previous request's failure.
  settled: Promise<void>;
};

let inFlight: InFlightGeneration | null = null;

// ---------------------------------------------------------------------------
// PART 3: per-request cancellation registry, keyed by WIRE id.
//
// Separate from `inFlight` on purpose. `inFlight` is the single-slot LOCK -- it
// only ever describes the generation currently holding the model, and it is
// keyed by nothing. A `cancel(id)` has to be able to reach a request that is
// still QUEUED behind that lock and has not started (and never will, if the
// cancel wins the race), which the lock slot cannot represent. Registered
// synchronously on receipt in handleGenerateRequest() and deleted in its
// `finally`, so an entry exists for exactly as long as main could still cancel.
const cancellable = new Map<number, AbortController>();

const runGeneration = async (
  abortController: AbortController,
  prompt: string,
  systemPrompt?: string,
  onTextChunk?: (text: string) => void,
  options?: WireGenerateOptions,
): Promise<string> => {
  const priority: GenerationPriority = options?.priority ?? 'explicit';
  generationSeq += 1;
  const id = `#${generationSeq}/${priority}`;
  const enteredAt = Date.now();
  const enteredAtHr = process.hrtime.bigint();

  lockLog(
    `${id} generate() ENTRY`,
    `lockHeld=${inFlight !== null}${inFlight ? ` byPriority=${inFlight.priority}` : ''}`,
    `promptLen=${prompt.length}`,
  );

  if (priority === 'opportunistic') {
    if (inFlight) {
      // Code Inference never queues -- it fails fast so the caller can skip.
      lockLog(`${id} REJECTED: lock held by ${inFlight.priority}; opportunistic never queues`);
      throw new ModelBusyError();
    }
  } else {
    while (inFlight) {
      if (inFlight.priority === 'opportunistic') {
        lockLog(`${id} cancelling in-flight opportunistic generation to take the lock`);
        inFlight.abort();
      }
      lockLog(`${id} WAITING on the lock...`);
      await inFlight.settled;
      lockLog(`${id} woke after waiting ${Date.now() - enteredAt}ms; rechecking lock`);
    }
  }

  // PART 3: a request cancelled WHILE QUEUED must never start work. Everything
  // above this point can have awaited (`await inFlight.settled` in the explicit
  // branch), so a cancel could have landed in that window -- and the whole
  // point of registering the controller before the lock wait is that such a
  // request is reachable. Checked here, immediately after the wait and before
  // the slot is claimed, so a cancelled waiter costs nothing but a lock cycle.
  if (abortController.signal.aborted) {
    lockLog(`${id} ABORTED while queued; never started`);
    throw new GenerationAbortedError();
  }

  // Claiming the slot must stay synchronous from the check above to the
  // assignment below -- no `await` in between. Otherwise two explicit waiters
  // resuming off the same `await inFlight.settled` would both see a free slot
  // and both claim it. With no await here, the first waiter to resume claims
  // it and the second re-enters the loop and waits on the first.
  //
  // `abortController` is now the CALLER'S (handleGenerateRequest owns it and
  // has it registered in `cancellable`) rather than one created here. Same
  // object serves both cancellation entry points: the lock's opportunistic
  // pre-emption below still calls .abort() on it exactly as before, and a
  // main-side cancel(id) now aborts the same controller.
  let markSettled: () => void = () => {};
  const settled = new Promise<void>((resolve) => {
    markSettled = resolve;
  });
  inFlight = { priority, abort: () => abortController.abort(), settled };
  phaseLog(id, 'lock-acquire (includes any wait behind another generation)', enteredAtHr, process.hrtime.bigint(), enteredAt, Date.now());
  lockLog(`${id} LOCK ACQUIRED after ${Date.now() - enteredAt}ms`);

  // RESOLVED IN PART 3 (2026-08-10). The caller-supplied `options.signal`
  // forwarding that used to sit here did not come back as a forwarded signal --
  // an AbortSignal still cannot cross a MessagePort, and never will. Instead
  // `llm.ts` subscribes to the caller's signal main-side and posts
  // `{ type: 'cancel', id }`, which the dispatcher at the bottom of this file
  // turns back into `.abort()` on this very controller. So the external entry
  // point that was missing now exists, and it converges on the same controller
  // the lock's opportunistic pre-emption has always used -- one abort path, two
  // ways in.

  let context: Awaited<ReturnType<LlamaRuntime['model']['createContext']>> | null = null;

  try {
    lockLog(`${id} awaiting initLlama() (loads the model on first use - can be slow)`);
    const modelReadyAt = Date.now();
    const modelReadyAtHr = process.hrtime.bigint();
    const { llama, model, chatWrapper } = await initLlama();
    phaseLog(id, 'initLlama() (0ms expected once warm/cached)', modelReadyAtHr, process.hrtime.bigint(), modelReadyAt, Date.now());
    lockLog(`${id} initLlama() ready in ${Date.now() - modelReadyAt}ms`);
    if (priority === 'explicit') {
      // Only logged for explicit calls -- Code Inference fires often enough
      // that logging every attempt would drown the console.
      console.log('[llm] generate() using GPU device(s):', await (llama as any).getGpuDeviceNames());
    }
    const { LlamaChatSession: SessionCtor } = await importNodeLlamaCpp();
    const createContextStartHr = process.hrtime.bigint();
    const createContextStartMs = Date.now();
    context = options?.contextSize
      ? await model.createContext({ contextSize: options.contextSize })
      : await model.createContext();
    phaseLog(id, 'createContext()', createContextStartHr, process.hrtime.bigint(), createContextStartMs, Date.now());

    const sessionConstructStartHr = process.hrtime.bigint();
    const sessionConstructStartMs = Date.now();
    const session = new SessionCtor({
      contextSequence: context.getSequence(),
      // Passed explicitly (instead of leaving this unset, which defaults to
      // "auto") so construction reuses the wrapper resolved once in
      // initLlama() rather than re-running the expensive brute-force search
      // on every call. See the FIX note on initLlama()'s resolveChatWrapper()
      // call above.
      chatWrapper,
      // The system prompt MUST be delivered via the constructor
      // (LlamaChatSessionOptions.systemPrompt). It is NOT a valid option on
      // session.prompt() -- LLamaChatPromptOptions has no systemPrompt field, so
      // passing it there is an excess property that node-llama-cpp silently
      // drops, and the model never sees the instruction. TypeScript doesn't flag
      // it because LLamaChatPromptOptions is a union-shaped intersection type,
      // which disables excess-property checking. This affects every caller that
      // relies on the systemPrompt arg (ai:translate, ai:explain); ai:complete
      // (Ask/Plan) embeds its instructions in the user prompt and is unaffected.
      systemPrompt,
    });
    phaseLog(id, 'new LlamaChatSession()', sessionConstructStartHr, process.hrtime.bigint(), sessionConstructStartMs, Date.now());

    lockLog(`${id} context created; GENERATION START maxTokens=${options?.maxTokens ?? 'unset'}`);
    const generationStartedAt = Date.now();
    const generationStartedAtHr = process.hrtime.bigint();

    // TEMPORARY DIAGNOSTIC: wraps onTextChunk (only when the caller passed one
    // -- when it didn't, `undefined` is still passed through unchanged below,
    // so non-streaming callers see no new callback and no behavior change) to
    // log time-to-first-token separately from total generation time. The
    // 08-07 heartbeat data showed streaming itself ticks the event loop
    // normally; this checks whether that holds for the setup-heavy first
    // token specifically, not just the tail of the stream.
    let firstTokenAtHr: bigint | null = null;
    const wrappedOnTextChunk = onTextChunk
      ? (text: string) => {
          if (firstTokenAtHr === null) {
            firstTokenAtHr = process.hrtime.bigint();
            phaseLog(id, 'prompt() time-to-first-token', generationStartedAtHr, firstTokenAtHr, generationStartedAt, Date.now());
          }
          onTextChunk(text);
        }
      : undefined;

    let result: string;
    try {
      result = await session.prompt(prompt, {
        // systemPrompt intentionally NOT here -- it belongs on the SessionCtor
        // constructor above; LLamaChatPromptOptions has no such field.
        onTextChunk: wrappedOnTextChunk,
        maxTokens: options?.maxTokens,
        signal: abortController.signal,
        // Resolve with whatever was generated instead of throwing on abort, so
        // the aborted/normal paths converge on one shape below.
        stopOnAbortSignal: true,
        customStopTriggers: options?.stopTriggers?.length ? options.stopTriggers : undefined,
      });
    } catch (err) {
      lockLog(
        `${id} GENERATION THREW after ${Date.now() - generationStartedAt}ms`,
        `aborted=${abortController.signal.aborted} message=${(err as Error)?.message}`,
      );
      // An abort raised before generation started still throws rather than
      // returning a partial, so normalize it to the same error either way.
      if (abortController.signal.aborted) throw new GenerationAbortedError();
      throw err;
    }

    const generationEndedAtHr = process.hrtime.bigint();
    phaseLog(id, 'prompt() total (generationStartedAt -> resolved)', generationStartedAtHr, generationEndedAtHr, generationStartedAt, Date.now());
    if (firstTokenAtHr !== null) {
      // Derived, not a separate measurement point: total minus TTFT. Isolates
      // pure token-streaming time from setup+prefill+first-token latency.
      phaseLog(id, 'prompt() post-first-token streaming', firstTokenAtHr, generationEndedAtHr, generationStartedAt, Date.now());
    }
    lockLog(
      `${id} GENERATION END in ${Date.now() - generationStartedAt}ms`,
      `resultLen=${result.length} aborted=${abortController.signal.aborted}`,
    );

    if (abortController.signal.aborted) throw new GenerationAbortedError();
    return result;
  } finally {
    if (context) await context.dispose();
    // Release the slot BEFORE signalling waiters -- a waiter resumes and
    // immediately re-reads `inFlight`, so it must already be null.
    inFlight = null;
    markSettled();
    lockLog(`${id} LOCK RELEASED; total ${Date.now() - enteredAt}ms end to end`);
  }
};

// ===========================================================================
// Message plumbing.
//
// PART 1 scope: request in, tokens + done/error out. Nothing else. Deliberately
// absent and deferred: `cancel` handling, crash/respawn cooperation, and any
// teardown/`destroy()` lifecycle -- see PART 2/3.
//
// `process.parentPort` is typed locally instead of via Electron's ambient
// NodeJS.Process augmentation, so this file needs no reference to Electron's
// types and the no-electron-imports invariant holds at compile time as well as
// runtime. Note the API is asymmetric on purpose: the worker side receives an
// EVENT and reads `.data`, while the main side receives the message directly.
// ===========================================================================
type ParentPortLike = {
  postMessage: (message: unknown) => void;
  on: (channel: 'message', listener: (event: { data: unknown }) => void) => void;
};

const parentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort;

if (!parentPort) {
  // Only reachable if this bundle is executed as a plain Node script rather
  // than via utilityProcess.fork(). Fail loudly instead of sitting silent.
  throw new Error('[llmWorker] process.parentPort is unavailable -- this module must be run via utilityProcess.fork().');
}

const post = (message: WorkerResponse) => parentPort.postMessage(message);

const handleGenerateRequest = async (
  request: Extract<WorkerRequest, { type: 'generate' }>,
) => {
  const { id } = request;

  // Created and registered HERE rather than inside runGeneration(), so the
  // registry entry's lifetime exactly brackets the window in which main could
  // still cancel -- including the queued-behind-the-lock period, which is
  // before runGeneration() does any work at all. The `finally` below is the
  // single deletion point, so no path (resolve, throw, ModelBusyError before
  // the lock) can leak an entry.
  const abortController = new AbortController();
  cancellable.set(id, abortController);

  try {
    const result = await runGeneration(
      abortController,
      request.prompt,
      request.systemPrompt,
      // Every chunk becomes its own message. Main re-dispatches it into the
      // original caller's onTextChunk callback, which is where the existing
      // event.sender.send('ai:token', chunk) calls already sit -- so the
      // renderer contract is untouched (DECISIONS.md section 4).
      (text: string) => post({ type: 'token', id, text }),
      request.options,
    );
    post({ type: 'done', id, result });
  } catch (err) {
    // An Error subclass does not survive postMessage; name-based
    // serialize/rehydrate is deliberate, not incidental. See llmProtocol.ts.
    // A cancelled generation lands here too, as a GenerationAbortedError --
    // that is the settle path, not a missing feature (see llmProtocol.ts on why
    // there is no separate 'cancelled' response type).
    post({ type: 'error', id, error: serializeError(err) });
  } finally {
    cancellable.delete(id);
  }
};

// PART 3. Fully synchronous and idempotent: it only trips an AbortController,
// and everything downstream (aborting session.prompt(), releasing the lock,
// posting the error reply) is already handled by the generation's own path.
// This deliberately does NOT settle anything itself -- see the "one settlement
// authority" note in llm.ts.
const handleCancelRequest = (id: number) => {
  const controller = cancellable.get(id);

  if (!controller) {
    // Not an error: cancel racing a generation that already finished is the
    // normal, expected outcome of a user hitting Cancel as the last token
    // lands. Logged rather than silent so a cancel that does nothing because
    // of an ID mismatch is still visible when debugging.
    lockLog(
      `cancel(#${id}) ignored -- no such request (already settled, or never started)`,
    );
    return;
  }

  if (controller.signal.aborted) {
    lockLog(`cancel(#${id}) ignored -- already aborting`);
    return;
  }

  lockLog(`cancel(#${id}) received -- aborting generation`);
  controller.abort();
};

parentPort.on('message', (event) => {
  const request = event.data as WorkerRequest | undefined;
  if (!request) return;

  if (request.type === 'generate') {
    // Not awaited: runGeneration() resolves through the message channel, and
    // the single-flight lock inside it -- not this handler -- is what
    // serializes overlapping requests. Awaiting here would add a second,
    // redundant queue. It would ALSO break cancellation outright: a cancel
    // could not be dispatched until the generation it targets had finished.
    void handleGenerateRequest(request);
    return;
  }

  if (request.type === 'cancel') {
    handleCancelRequest(request.id);
  }
});

// Announce readiness only after the listener above is attached, so main never
// posts into a worker that cannot yet answer. (MessagePortMain queues messages
// until a listener starts the port, so this is belt-and-braces -- but it also
// gives main a definite "the worker booted and its JS ran" signal, which a
// bare `spawn` event does not.)
// ===========================================================================
// PART 2: parent-death watchdog.
//
// The PRIMARY teardown is main's: `app.on('before-quit')` calls
// `shutdownWorker()` in `llm.ts`, which covers both a normal quit and
// electronmon's hot-reload restart (that restart is itself an `app.quit()` --
// see the comment on shutdownWorker). This watchdog is the backstop for the
// cases where main never gets to run that code at all:
//
//   - main hard-killed from Task Manager / `taskkill`
//   - electronmon's post-uncaught-exception restart, which calls
//     `globalApp.kill('SIGINT')`; on Windows every signal is a TerminateProcess,
//     so no JS handler in main runs
//   - main crashing outright
//
// In each of those, an orphaned worker keeps a ~5GB model resident in VRAM with
// nothing left to reclaim it. Chromium child processes are *expected* to notice
// the broken mojo channel to a dead browser process and exit on their own, so
// this may well be redundant -- but "expected to" is not a guarantee I can read
// off the docs, and the cost of being wrong is the exact VRAM leak PART 2 exists
// to close. A ~15-line poll is cheap insurance for that.
//
// `process.kill(pid, 0)` sends no signal; it is the standard existence probe.
// Only ESRCH ("no such process") counts as death -- EPERM means the process is
// alive but not probeable, which must NOT trigger an exit.
//
// Deliberately NOT unref()'d: this must outlive every other handle in the
// process. The worker is always terminated explicitly (by main, or by the
// process.exit here), never by letting its event loop run dry.
// ===========================================================================
const PARENT_PID_ARG = '--parent-pid=';
const PARENT_WATCHDOG_INTERVAL_MS = 5000;

const startParentWatchdog = () => {
  const arg = process.argv.slice(2).find((a) => a.startsWith(PARENT_PID_ARG));
  const parentPid = arg ? Number(arg.slice(PARENT_PID_ARG.length)) : NaN;

  if (!Number.isInteger(parentPid) || parentPid <= 0) {
    console.warn(
      `[llmWorker] no usable ${PARENT_PID_ARG} fork argument; the parent-death watchdog is OFF. ` +
        `If main is hard-killed, this process may survive holding the model in VRAM.`,
    );
    return;
  }

  setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch (err) {
      // Duck-typed rather than `NodeJS.ErrnoException` because the `NodeJS`
      // global namespace is not visible to eslint's no-undef under this config.
      if ((err as { code?: string })?.code !== 'ESRCH') return;
      console.error(
        `[llmWorker] parent main process (pid ${parentPid}) is gone -- exiting so the model ` +
          `is released from VRAM instead of leaking with an orphaned process.`,
      );
      process.exit(0);
    }
  }, PARENT_WATCHDOG_INTERVAL_MS);
};

startParentWatchdog();

post({ type: 'ready' });
