// ===========================================================================
// Shared, ELECTRON-FREE contract between the main-process proxy (`llm.ts`) and
// the inference utility process (`llmWorker.ts`).
//
// PART 1 of the utility-process migration (DECISIONS.md 2026-08-07 section 5,
// work item 4: "Define the message protocol"). This file exists so the two
// sides cannot drift out of sync -- a wire-shape change is a compile error on
// both ends rather than a runtime mystery.
//
// HARD RULE: nothing in this file may import `electron`, directly or
// transitively. `llmWorker.ts` imports it, and the whole point of the split is
// that the worker never touches Electron's main-process API (DECISIONS.md
// section 2: `import { app } from 'electron'` was the single coupling, and it
// stays behind in `llm.ts`).
// ===========================================================================

// Moved verbatim from `llm.ts`. Lives here rather than in the worker because
// the proxy's public `generate()` signature still advertises it to callers.
// See the long single-flight-lock comment in `llmWorker.ts` for the policy and
// for why 'opportunistic' is kept despite currently having zero callers.
export type GenerationPriority = 'explicit' | 'opportunistic';

// The subset of `generate()`'s options that can actually cross a MessagePort.
//
// NOTE what is deliberately ABSENT, and why that is now fine: `signal?:
// AbortSignal`. An AbortSignal is not structured-cloneable, so it can never be
// posted (DECISIONS.md section 4). PART 3 (2026-08-10) resolves this not by
// serializing the signal but by FLATTENING it: `llm.ts` keeps accepting a
// `signal` on its public `generate()` signature, subscribes to it main-side,
// and turns an abort into a `{ type: 'cancel', id }` message on this wire. The
// signal object stays in main; only the fact that it fired ever crosses.
export type WireGenerateOptions = {
  maxTokens?: number;
  contextSize?: number;
  priority?: GenerationPriority;
  stopTriggers?: string[];
};

// --- main -> worker --------------------------------------------------------
// A union as of PART 3. `cancel` carries the SAME `id` as the `generate` it
// cancels -- that correlation is the entire mechanism, and it is why the worker
// keeps a per-request AbortController registry keyed by wire id rather than
// relying on its single-slot `inFlight` (a request still queued behind the lock
// has no slot yet, but must still be cancellable).
//
// Ordering note: MessagePort delivery is ordered, so a `cancel` posted after
// its `generate` is always dispatched after it. That is what lets the worker
// register the request synchronously on receipt and be certain the id is known
// by the time any cancel for it arrives.
export type WorkerRequest =
  | {
      type: 'generate';
      id: number;
      prompt: string;
      systemPrompt?: string;
      options?: WireGenerateOptions;
    }
  | { type: 'cancel'; id: number };

// --- worker -> main --------------------------------------------------------
// `ready` is a startup handshake, not a per-request message, so it carries no
// id. Everything else is correlated back to a pending promise by `id`.
//
// PART 3 deliberately did NOT add a `cancelled` variant here. A cancelled
// generation already has an exact representation on this wire: `error` carrying
// a serialized `GenerationAbortedError`, which `rehydrateError()` turns back
// into a real instance main-side. Adding a fourth response type would mean a
// second settle path for every consumer to handle, for zero information gain --
// callers that care can already branch on `instanceof GenerationAbortedError`
// or `.name`, exactly as codeInference.ts does today.
export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'token'; id: number; text: string }
  | { type: 'done'; id: number; result: string }
  | { type: 'error'; id: number; error: SerializedError };

// An Error subclass does NOT survive postMessage -- it arrives as a plain
// object with its prototype stripped (DECISIONS.md section 4). So error
// identity is carried by NAME and rebuilt deliberately on the main side rather
// than left to chance. Both existing catch sites already read `.name`/
// `.message` rather than using `instanceof` (codeInference.ts:599), so this is
// sufficient for them -- but `rehydrateError()` below still restores real
// class instances for the two known types, so `instanceof` keeps working for
// any future caller.
export type SerializedError = {
  name: string;
  message: string;
  stack?: string;
};

export class ModelBusyError extends Error {
  constructor() {
    super('Model is busy with another generation.');
    this.name = 'ModelBusyError';
  }
}

export class GenerationAbortedError extends Error {
  constructor() {
    super('Generation was aborted.');
    this.name = 'GenerationAbortedError';
  }
}

export const serializeError = (err: unknown): SerializedError => {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { name: 'Error', message: String(err) };
};

// Rebuilds a real Error on the main side. The two known subclasses are
// reconstructed as genuine instances (so `instanceof` survives the hop); any
// other error becomes a plain Error carrying the original name/message/stack,
// which is what every current catch site reads.
export const rehydrateError = (serialized: SerializedError): Error => {
  if (serialized.name === 'ModelBusyError') return new ModelBusyError();
  if (serialized.name === 'GenerationAbortedError') return new GenerationAbortedError();

  const err = new Error(serialized.message);
  err.name = serialized.name;
  if (serialized.stack) err.stack = serialized.stack;
  return err;
};
