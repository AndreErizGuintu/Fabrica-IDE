// ===========================================================================
// Main-process PROXY for inference. The model itself now lives in a dedicated
// Electron utility process (`llmWorker.ts`) -- split out 2026-08-09 as PART 1
// of the utility-process migration scoped in DECISIONS.md (2026-08-07,
// "Main-process blocking", sections 1-5).
//
// This file keeps exactly two responsibilities:
//   1. Resolve the model path. This is the ONE thing that genuinely needs
//      Electron's main process (`app.isPackaged` / `app.getAppPath()`), and it
//      is the entire reason the split is not just "move the file". The
//      resolved absolute path is handed to the worker as a fork argument so
//      the worker never imports `electron` (DECISIONS.md section 2).
//   2. Speak the message protocol in `llmProtocol.ts`, exposing the SAME
//      `generate(prompt, systemPrompt?, onTextChunk?, options?)` signature all
//      5 existing callers already use -- `main.ts` (ai:complete / ai:translate
//      / ai:explain / llama-test-ping), `adaptiveEngine.ts`, and
//      `codeInference.ts`. Zero call-site changes; zero renderer-visible
//      change; `preload.ts`, `preload.d.ts` and every renderer file untouched
//      (DECISIONS.md section 4).
//
// PART 1 IS THE HAPPY PATH ONLY. Deliberately NOT here yet, each deferred to
// PART 2/3 and each called out at its site below: cancellation / abort
// plumbing, crash-and-respawn policy, dev hot-reload teardown, the production
// webpack entry and its fork path, and anything beyond plain env inheritance
// for GPU isolation.
// ===========================================================================

import fs from 'fs';
import path from 'path';
import type { Writable } from 'stream';
import { app, utilityProcess } from 'electron';
import modelConfig from './modelConfig.json';
import {
  GenerationPriority,
  ModelBusyError,
  GenerationAbortedError,
  WorkerRequest,
  WorkerResponse,
  rehydrateError,
} from './worker/llmProtocol';

// Re-exported so `llm.ts` remains the single import site for anything that
// used to reach for these here. Both currently have zero external callers
// (DECISIONS.md section 2 export audit) but they are part of the documented
// surface, and `rehydrateError()` rebuilds real instances of both, so
// `instanceof` still works across the process hop.
export { ModelBusyError, GenerationAbortedError };
export type { GenerationPriority };

// Single swap point: change modelFile in src/main/modelConfig.json and drop the new
// .gguf into resources/models/ to switch models. scripts/benchmark.mjs and
// scripts/test-gpu-layers.mjs read the same file, so this is the only place to edit.
const MODEL_FILE = modelConfig.modelFile;

// NOTE: `GPU_LAYERS` and the gpuLayers step-down ladder moved to
// `llmWorker.ts` -- they configure model loading, which no longer happens in
// this process. Verified zero importers outside `llm.ts` before removing the
// export (the `GPU_LAYERS` hits in scripts/*.mjs are env-var reads, not
// imports of this module).

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
// Fork-path resolver.
//
// DECISIONS.md section 5 flagged this as "the single most likely item to eat an
// unplanned hour", because the dev and prod webpack configs emit to a DIFFERENT
// DIRECTORY under a DIFFERENT FILENAME, and a mistake here fails at runtime
// with module-not-found rather than at compile time. Hence: candidates are
// probed with existsSync and a miss throws a message naming every path tried,
// instead of surfacing as an opaque spawn failure.
//
// dev  : webpack.config.main.dev.ts emits to webpackPaths.dllPath (.erb/dll)
//        as `[name].bundle.dev.js`. `node: { __dirname: false }` in that config
//        means __dirname here is the REAL directory of main.bundle.dev.js, so
//        the worker is its sibling. app.getAppPath() (the repo root in dev) is
//        kept as a second candidate purely as a belt-and-braces fallback.
// prod : DONE (PART 2, 2026-08-10). `webpack.config.main.prod.ts` now carries
//        the matching llmWorker entry, emitting to webpackPaths.distMainPath as
//        `[name].js` -- so `llmWorker.js` is a sibling of `main.js`, and with
//        `node: { __dirname: false }` set in that config too, __dirname here is
//        the real directory of main.js at runtime. electron-builder packs
//        `dist` into app.asar (package.json build.files), so the resolved path
//        is an in-asar path; Electron's patched fs makes existsSync see it, and
//        utilityProcess.fork() reads modules out of the asar the same way
//        require() does. The path shape did not change from what PART 1
//        predicted -- only the entry that makes the file exist, plus this note.
// FORK TARGET, 2026-08-22: the crash-visibility bootstrap, not the worker
// module itself. `llmWorkerBootstrap.ts` installs uncaughtException /
// unhandledRejection handlers and then require()s `llmWorker` inside a
// try/catch, so a synchronous top-level throw in the worker arrives here as a
// stack on stderr instead of an ambiguous exit code. The worker module is
// still built as its own entry in both webpack main configs -- it is now
// REQUIRED by the bootstrap rather than forked directly.
const DEV_WORKER_BUNDLE = 'llmWorkerBootstrap.bundle.dev.js';
const PROD_WORKER_BUNDLE = 'llmWorkerBootstrap.js';

// The real worker module, a sibling of the bootstrap in both layouts. Main
// never forks this -- the only thing here that still cares about it is the dev
// bundle watcher, which must watch the file you actually EDIT.
const DEV_WORKER_MODULE_BUNDLE = 'llmWorker.bundle.dev.js';

// ---------------------------------------------------------------------------
// ASAR UNPACK REDIRECT (2026-08-23). ROOT CAUSE of the packaged-only failure
// where the forked worker came up with `process.parentPort` unavailable:
// `utilityProcess.fork()` needs a REAL FILE ON DISK. Electron's patched `fs`
// makes an in-asar path pass `existsSync()` and lets `require()` read it, so
// the old packaged branch looked correct and resolved happily -- but the fork
// itself is a process spawn, and the OS cannot execute a path that lives
// inside an archive. Dev never hit this because it forks a loose file out of
// .erb/dll.
//
// The fix has two halves and BOTH are required:
//   1. package.json `build.asarUnpack` now lists dist/main/llmWorker.js and
//      dist/main/llmWorkerBootstrap.js, so electron-builder ALSO writes them
//      to resources/app.asar.unpacked/ with the same relative subpath.
//   2. this function, which must point the fork at that unpacked copy.
//      Electron auto-redirects app.asar -> app.asar.unpacked for many APIs,
//      but NOT for utilityProcess.fork(), so the path is built explicitly.
//
// Segment-aware on purpose: a blind `.replace('app.asar', ...)` would also
// corrupt a user directory that happens to contain that substring, and would
// double-rewrite a path that is already `.unpacked`. The regex requires
// `app.asar` to be a whole path segment and rewrites only the first match.
const toUnpackedPath = (packedPath: string): string | null => {
  const asarSegment = /([\\/])app\.asar([\\/])/;
  if (!asarSegment.test(packedPath)) return null;
  return packedPath.replace(asarSegment, '$1app.asar.unpacked$2');
};

const resolveWorkerPath = (): string => {
  if (app.isPackaged) {
    // The in-asar path -- still the shape __dirname gives us, still what the
    // unpacked path is derived FROM, but no longer what we prefer to fork.
    const packed = path.join(__dirname, PROD_WORKER_BUNDLE);
    const unpacked = toUnpackedPath(packed);

    if (unpacked && fs.existsSync(unpacked)) {
      return unpacked;
    }

    // Deliberately loud rather than silent. Reaching here means the
    // asarUnpack entry in package.json was renamed, dropped, or stopped
    // matching (e.g. the emitted filename changed) -- a packaging-config
    // regression that would otherwise resurface as the same opaque
    // "parentPort unavailable" crash this whole change exists to remove.
    console.warn(
      `[llm] Worker bundle not found at the expected app.asar.unpacked path:\n` +
        `  ${unpacked ?? '(could not derive -- no "app.asar" path segment)'}\n` +
        `Falling back to the in-asar path, which utilityProcess.fork() usually ` +
        `CANNOT launch (it needs a real on-disk file). If the inference worker ` +
        `dies at startup, fix build.asarUnpack in package.json -- it must list ` +
        `dist/main/${PROD_WORKER_BUNDLE} and dist/main/llmWorker.js.`,
    );

    if (fs.existsSync(packed)) {
      return packed;
    }

    throw new Error(
      `[llm] Inference worker bundle not found (packaged=true). Looked in:\n` +
        `  ${unpacked ?? '(no app.asar segment to derive an unpacked path from)'}\n` +
        `  ${packed}\n` +
        `This means the llmWorkerBootstrap entry in webpack.config.main.prod.ts ` +
        `did not emit, or dist/main was not packed into the app -- check ` +
        `build.files and build.asarUnpack in package.json.`,
    );
  }

  // Dev branch unchanged -- confirmed working, forks a loose file out of
  // .erb/dll where no asar is involved at all.
  const candidates = [
    path.join(__dirname, DEV_WORKER_BUNDLE),
    path.join(app.getAppPath(), '.erb', 'dll', DEV_WORKER_BUNDLE),
  ];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    const tried = candidates.map((c) => `  ${c}`).join('\n');
    throw new Error(
      `[llm] Inference worker bundle not found (packaged=false). Looked in:\n${tried}\n` +
        `Re-run the main webpack build (npm run start rebuilds it).`,
    );
  }

  return found;
};

// ---------------------------------------------------------------------------
// Worker handle + in-flight request table.
type WorkerHandle = ReturnType<typeof utilityProcess.fork>;

type PendingRequest = {
  resolve: (result: string) => void;
  reject: (err: Error) => void;
  onTextChunk?: (text: string) => void;
  // PART 3: detaches this request's 'abort' listener from the caller's
  // AbortSignal. A caller can reasonably hold one long-lived signal across many
  // generate() calls, so leaving listeners attached would accumulate one per
  // call for the life of that signal. Must run on EVERY settle path, which is
  // why settlement funnels through settlePending()/failAllPending() rather than
  // touching `pending` directly.
  cleanup?: () => void;
};

const pending = new Map<number, PendingRequest>();
let requestSeq = 0;
let workerPromise: Promise<WorkerHandle> | null = null;

// ---------------------------------------------------------------------------
// PART 2 lifecycle state (2026-08-10).
//
// `activeWorker` intentionally duplicates what `workerPromise` resolves to.
// Quit teardown runs inside `app.on('before-quit')`, which is SYNCHRONOUS --
// Electron does not wait on a promise there, and by the time an
// `await workerPromise` resolved the process would already be gone. A plain
// handle is the only thing that can be killed synchronously. Assigned when the
// spawn handshake resolves, cleared the moment the worker dies or is killed.
let activeWorker: WorkerHandle | null = null;

// Distinguishes "the worker exited because we asked it to" (expected: quit,
// hot-reload recycle -- do not respawn, report as cancelled) from "the worker
// died on its own" (crash: fail outstanding work, allow a respawn). Without
// this the 'exit' handler cannot tell a clean teardown from a native crash,
// and every quit would log a scary crash message.
const intentionallyKilled = new WeakSet<WorkerHandle>();

// Latched by shutdownWorker(). Nothing in main.ts calls preventDefault() on
// 'before-quit', so once this is set the app IS going away -- there is no
// "quit cancelled" path to un-latch for. Guards ensureWorker() so a late
// generate() during teardown cannot spawn a worker that would outlive main.
let shuttingDown = false;

// RESPAWN POLICY -- self-healing, with a crash-loop brake.
//
// Decision: a crashed worker is NOT sticky. `workerPromise` is cleared on exit,
// so the next generate() transparently forks a fresh process. Rationale: the
// crash cases worth designing for (a native llama.cpp fault, an OOM kill, VRAM
// exhaustion under another GPU app) are overwhelmingly transient, the recovery
// is identical to what a user would do by hand, and the alternative -- a dead
// AI panel until the whole app is restarted -- is strictly worse than the
// pre-migration behaviour, where a native crash at least took main down loudly
// instead of leaving a permanently broken button.
//
// The brake exists because unconditional self-healing has a genuinely bad
// failure mode: a worker that crashes DURING model load (corrupt .gguf, driver
// fault) would be re-forked on every call, and each attempt costs the ~14s load
// measured in DECISIONS.md §9 before dying again. After MAX_CONSECUTIVE_CRASHES
// failures with no successful reply in between, ensureWorker() refuses to fork
// and says so. Any completed reply -- 'done' OR a normal 'error' response, both
// of which prove the worker is alive and talking -- resets the counter.
// Threshold is a judgment call, not a measurement: 3 is enough to ride out a
// one-off fault while capping a hard-failure loop at ~45s of wasted loads.
let consecutiveCrashes = 0;
const MAX_CONSECUTIVE_CRASHES = 3;

// PART 2 of the 2026-08-22 diagnostic pass. How long spawnWorker() waits for
// the worker's 'ready' handshake before declaring it hung.
//
// Generous on purpose: `post({ type: 'ready' })` is the LAST line of
// llmWorker.ts's module evaluation and fires long before any model load (that
// is lazy, on first generate()), so a healthy worker answers in well under a
// second. 10s is therefore a hang detector, not a performance budget -- but it
// is a named constant precisely so it can be tuned from one place if a slow
// cold disk on a packaged build ever proves otherwise.
const WORKER_READY_TIMEOUT_MS = 10_000;

// DEV ONLY. Set when the worker bundle is rewritten on disk while a worker is
// running -- see watchWorkerBundleInDev() for why this case needs handling at
// all and why it is not covered by the before-quit teardown.
let workerBundleIsStale = false;
let workerBundleWatcher: fs.FSWatcher | null = null;

// Was `inFlight !== null` when the lock lived in this process. The real lock
// now lives in the worker (DECISIONS.md section 4: the process that owns the
// model owns its lock), so main can only report what IT has outstanding. That
// is a slightly different question than "is the model mid-generation", and the
// difference is noted rather than papered over -- this export has zero callers,
// so nothing depends on the distinction today.
export const isModelBusy = () => pending.size > 0;

// Settle every outstanding generate() with the same error. This is the whole
// point of PART 2 work item 3: before this existed, a worker that died mid-
// request left its caller's promise pending FOREVER -- the AI panel would spin
// with no error, no result and no timeout. A hang is a worse failure than a
// crash because nothing downstream can react to it.
//
// The map is cleared BEFORE any reject fires: a rejection handler that
// synchronously calls generate() again must not be able to observe (or have its
// brand-new request swept up by) a half-drained table.
const failAllPending = (err: Error) => {
  if (pending.size === 0) return;
  console.error(
    `[llm] failing ${pending.size} outstanding generate() request(s): ${err.message}`,
  );
  const entries = [...pending.values()];
  pending.clear();
  entries.forEach((entry) => {
    entry.cleanup?.();
    entry.reject(err);
  });
};

// The ONLY way a request leaves `pending`. Centralised so the cleanup callback
// (PART 3) cannot be forgotten on a settle path -- the failure mode would be a
// slow listener leak on a long-lived caller signal, which is invisible until it
// isn't.
const settlePending = (id: number): PendingRequest | undefined => {
  const entry = pending.get(id);
  if (!entry) return undefined;
  pending.delete(id);
  entry.cleanup?.();
  return entry;
};

// Kill a worker on purpose, flagging it first so the 'exit' handler reports a
// clean shutdown rather than a crash and does not count it toward the
// crash-loop brake. Also detaches it as the current worker, which is what makes
// the next generate() fork a fresh one.
const killWorker = (child: WorkerHandle, reason: string) => {
  intentionallyKilled.add(child);
  console.log(
    `[llm] terminating inference utility process (pid ${child.pid ?? 'unknown'}) -- ${reason}`,
  );
  if (activeWorker === child) {
    activeWorker = null;
    workerPromise = null;
  }
  child.kill();
};

// DEV ONLY. Recycle a worker whose bundle changed on disk, but only once it is
// idle -- killing mid-generation would fail a request the user is watching
// stream in, for no benefit, since the point is only that the NEXT request runs
// the new code.
const maybeRecycleStaleWorker = () => {
  if (!workerBundleIsStale || shuttingDown) return;
  if (pending.size > 0) return; // drain first; re-checked as each request settles
  workerBundleIsStale = false;
  if (activeWorker) {
    killWorker(activeWorker, 'worker bundle changed on disk (dev hot-reload)');
  }
};

const handleWorkerMessage = (message: WorkerResponse) => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'ready') return; // consumed by the spawn handshake below

  // Any reply at all proves the worker booted, loaded the model and is talking
  // -- including an 'error' reply, which is a normal generation outcome
  // (ModelBusyError, a bad prompt) and not a sign of process ill health. That
  // is the signal the crash-loop brake needs, so it is reset here rather than
  // only on 'done'.
  if (message.type === 'done' || message.type === 'error') {
    consecutiveCrashes = 0;
  }

  const entry = pending.get(message.id);
  if (!entry) {
    // Late token for a request that already settled -- e.g. one failed by
    // failAllPending() during teardown. Dropping it is correct; the recycle
    // check still runs below so a stale worker is not kept alive by traffic
    // nobody is waiting on any more.
    if (message.type === 'done' || message.type === 'error') {
      maybeRecycleStaleWorker();
    }
    return;
  }

  switch (message.type) {
    case 'token':
      // Re-dispatched straight into the original caller's callback -- which is
      // where main.ts's existing `event.sender.send('ai:token', chunk)` calls
      // already sit, so the renderer sees an identical stream. Streaming is now
      // worker -> main -> renderer (two hops), which DECISIONS.md section 4
      // records as a real-but-negligible cost at 6.7B token rates.
      entry.onTextChunk?.(message.text);
      break;
    case 'done':
      settlePending(message.id);
      entry.resolve(message.result);
      maybeRecycleStaleWorker();
      break;
    case 'error':
      settlePending(message.id);
      // A cancelled generation arrives here as a serialized
      // GenerationAbortedError and is rehydrated into a real instance, so
      // `instanceof GenerationAbortedError` works at the call site.
      entry.reject(rehydrateError(message.error));
      maybeRecycleStaleWorker();
      break;
    default:
      break;
  }
};

// DEV ONLY: recycle the worker when its bundle is rebuilt.
//
// Not redundant with the before-quit teardown, because electronmon treats the
// two bundles differently. It restarts main only for files main actually
// `require`s at runtime (`appfiles`, populated via runtime-required) -- and the
// worker bundle is FORKED, never required, so it is not in that set. Editing
// `llmWorker.ts` therefore rebuilds `.erb/dll/llmWorker.bundle.dev.js` and
// electronmon classifies it as a renderer-ish change: it sends 'reload', main
// never restarts, and the running worker keeps serving the OLD code with the
// old model still resident.
//
// That is not a VRAM leak (still exactly one worker), it is a correctness trap:
// you edit worker code, see no behaviour change, and conclude the edit did not
// work. Given a whole session was lost to exactly that class of bug -- worker
// changes that appeared to do nothing -- it is worth the ~20 lines.
const watchWorkerBundleInDev = (workerPath: string) => {
  if (app.isPackaged || workerBundleWatcher) return;

  try {
    workerBundleWatcher = fs.watch(workerPath, () => {
      if (workerBundleIsStale) return; // webpack fires several events per write
      workerBundleIsStale = true;
      console.log(
        '[llm] worker bundle changed on disk -- the running inference process is stale ' +
          'and will be recycled once idle (dev only).',
      );
      maybeRecycleStaleWorker();
    });
  } catch (err) {
    // Non-fatal by design: this is a convenience, and losing it must never stop
    // inference from working.
    console.warn(
      '[llm] could not watch the worker bundle for changes; worker hot-recycle is off ' +
        'for this session. Restart the app after editing llmWorker.ts.',
      err,
    );
  }
};

const spawnWorker = (): Promise<WorkerHandle> =>
  new Promise<WorkerHandle>((resolve, reject) => {
    const workerPath = resolveWorkerPath();
    const modelPath = getModelPath();

    console.log('[llm] forking inference utility process:', workerPath);

    // `--parent-pid` is the backstop for the one teardown path main cannot cover
    // from JS: if main is hard-killed (Task Manager, or electronmon's
    // post-uncaught-exception `kill('SIGINT')` restart, which on Windows is a
    // TerminateProcess), no 'before-quit' runs and nothing in this file gets the
    // chance to kill the worker. The worker watches this pid and exits on its
    // own when it disappears -- see startParentWatchdog() in llmWorker.ts.
    const forkArgs = [
      `--model-path=${modelPath}`,
      `--parent-pid=${process.pid}`,
    ];

    const child = utilityProcess.fork(workerPath, forkArgs, {
      serviceName: 'fabrica-inference',
      // 'pipe', NOT 'inherit' -- see the relay immediately after this call.
      //
      // FIX 2026-08-10: this was `stdio: 'inherit'` (which is also Electron's
      // default), on the reasoning that inheriting main's stdout would land the
      // worker's log lines in the same dev terminal they printed to before the
      // split. It does not. The 08-10 run completed a full generation
      // end-to-end -- the AI panel returned real text -- while printing ZERO
      // `[llm] DIAGNOSTIC:`, `[generate:phase]` and `[CodeInference:lock]`
      // lines, even though main's own `[llm] forking...` / `[llm] ... ready`
      // lines came through the same terminal in the same run. Every log line
      // the migration was supposed to preserve was being silently dropped.
      //
      // Why 'inherit' fails here specifically: a utility process is a Chromium
      // child process launched through Chromium's process launcher, NOT
      // `child_process.fork()`, so 'inherit' depends on the browser process's
      // OS-level stdout/stderr HANDLES surviving that launch. In this dev setup
      // they do not, and main's fd 1 is not a console to begin with:
      // `concurrently` pipes electronmon's stdout (that pipe is where the `[1] `
      // prefix on every line in session.log comes from), and electronmon passes
      // its own fds down to electron
      // (`node_modules/electronmon/src/electronmon.js:63-70` --
      // `isStdWritable(process.stdout)` is true, so it spawns electron with
      // 'inherit'). By the time the utility process launches, the handle it
      // would have to inherit is a pipe owned two processes upstream.
      //
      // So: stop depending on handle inheritance and relay in JS instead --
      // which is exactly what electronmon itself falls back to when it cannot
      // rely on inheritance (`electronmon.js:85-87`,
      // `app.stdout.pipe(stdio[1], { end: false })`). Platform- and
      // launcher-independent, so it holds regardless of the Chromium-level
      // detail above.
      stdio: 'pipe',
      // Explicit rather than implicit, per DECISIONS.md section 3: a fork IS a
      // process creation with an env block we control, which is exactly the
      // condition GGML_VK_VISIBLE_DEVICES requires (it does not take effect
      // when set mid-process). In dev the var is already set before Electron
      // launched, and in packaged builds gpuIsolation.ts's relaunch has already
      // put it in main's env, so plain inheritance carries the correct value.
      //
      // PART 2/3: passing an explicitly re-probed device index here (and
      // thereby retiring gpuIsolation.ts's app.relaunch() dance) is the
      // simplification this migration unlocks -- deliberately NOT bundled into
      // this change, per DECISIONS.md section 3's "port first, keep the
      // relaunch, remove it as a separate independently-testable follow-up".
      env: { ...process.env } as Record<string, string>,
    });

    // Relay the worker's stdout/stderr into main's, so `[llm] DIAGNOSTIC:`,
    // `[generate:phase]` and `[CodeInference:lock]` land in the dev terminal
    // exactly as they did pre-split (see the stdio comment above for why the
    // 'inherit' path could not do this).
    //
    // Chunks are written through RAW and unmodified -- no line splitting, no
    // added prefix, no re-encoding. The whole point is that existing log
    // captures and greps against these prefixes keep working byte-for-byte, and
    // re-wrapping the output is the easiest way to break that. Line prefixing is
    // concurrently's job and it will do it on the way out, same as for main's
    // own lines.
    //
    // Attached synchronously on the line after fork(), before any await, so
    // nothing the worker prints at boot can be missed: `child.stdout` is a
    // paused readable until a 'data' listener attaches, and a paused readable
    // buffers rather than discards.
    const relay = (
      // `typeof child.stdout` rather than the spelled-out
      // `NodeJS.ReadableStream | null`, and `Writable` rather than
      // `NodeJS.WritableStream`: same types to the compiler, but the `NodeJS`
      // global namespace is not visible to eslint's no-undef under this config,
      // and these forms sidesteps that without a config change or an inline
      // disable. `Writable` (not `typeof process.stdout`) because stdout and
      // stderr have different literal `fd` types and both are passed here.
      source: typeof child.stdout,
      sink: Writable,
    ) => {
      if (!source) return; // only null if stdio was not 'pipe'
      source.on('data', (chunk: Buffer) => sink.write(chunk));
      // Swallow, deliberately. These fire when the pipe tears down mid-write
      // (worker killed, or concurrently going away on Ctrl-C) and an unhandled
      // 'error' on a stream would take the main process down over lost DEBUG
      // output. A dead log pipe must never be fatal.
      source.on('error', () => {});
    };

    relay(child.stdout, process.stdout);
    relay(child.stderr, process.stderr);

    // NOT `workerPath` -- that is now the bootstrap bundle, which almost never
    // changes. The file you actually edit is llmWorker.ts, so the hot-recycle
    // watcher has to stay pointed at ITS bundle (a sibling of the bootstrap's),
    // or editing worker code would silently go back to having no effect until
    // restart -- the exact trap that watcher was written to close.
    watchWorkerBundleInDev(
      path.join(path.dirname(workerPath), DEV_WORKER_MODULE_BUNDLE),
    );

    let settled = false;

    // PART 2: the last silent startup failure gets a clock.
    //
    // Every OTHER startup failure already settles this promise: a missing
    // bundle throws in resolveWorkerPath(), and a process that dies is caught
    // by the 'exit' handler below. A worker that neither throws nor exits --
    // wedged inside module evaluation, a native load that never returns, a GPU
    // driver call that blocks -- settles NOTHING, and ensureWorker() awaits it
    // forever without printing a thing. That is the one shape left that fails
    // invisibly.
    const readyTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Through killWorker(), not child.kill(): otherwise the hung process sits
      // holding VRAM while the next generate() forks a SECOND one, and its
      // eventual 'exit' would be booked as a crash. The crash-loop brake counts
      // crashes; this is a timeout, and killWorker() is the existing, untouched
      // mechanism for "main killed it on purpose".
      killWorker(
        child,
        `no 'ready' handshake within ${WORKER_READY_TIMEOUT_MS}ms`,
      );
      reject(
        new Error(
          `[llm] worker did not signal ready within ` +
            `${WORKER_READY_TIMEOUT_MS / 1000}s -- likely hung during module ` +
            `evaluation. Check the [llmWorker BOOTSTRAP] lines above: if the ` +
            `boot line printed but "real worker module loaded" never did, the ` +
            `hang is inside llmWorker.ts's own top-level code.`,
        ),
      );
    }, WORKER_READY_TIMEOUT_MS);

    const onReady = (message: WorkerResponse) => {
      if (settled || !message || message.type !== 'ready') return;
      settled = true;
      clearTimeout(readyTimer);
      // Recorded only once the handshake completes, so a worker that dies
      // before ever answering is never mistaken for the live one -- the exit
      // handler below keys every decision off `activeWorker === child`.
      activeWorker = child;
      console.log('[llm] inference utility process ready (pid', child.pid, ')');
      resolve(child);
    };

    child.on('message', onReady);
    child.on('message', handleWorkerMessage);

    // PART 2 work item 3: crash handling. DECISIONS.md §5 named this the most
    // likely way the migration produces a WORSE experience than the freeze it
    // fixed -- pre-migration a native crash took the whole app down loudly,
    // which is ugly but unmistakable; a worker crash with no handler here is
    // SILENT, and every caller's promise hangs forever. Loud failure beats a
    // hang, so every exit path below settles something.
    child.on('exit', (code) => {
      // The worker is gone; whatever it was going to do, waiting for 'ready' is
      // no longer one of the outcomes.
      clearTimeout(readyTimer);
      // Guarded: a late exit from a worker we already replaced must not clear
      // the CURRENT one's handle or promise.
      const wasCurrent = activeWorker === child;
      if (wasCurrent) {
        activeWorker = null;
        workerPromise = null; // self-healing: the next generate() forks afresh
      }

      const intentional = intentionallyKilled.has(child) || shuttingDown;

      if (intentional) {
        console.log(
          `[llm] inference utility process exited with code ${code} (expected -- terminated by main).`,
        );
      } else {
        consecutiveCrashes += 1;
        console.error(
          `[llm] inference utility process CRASHED (exit code ${code}) -- ` +
            `consecutive crash ${consecutiveCrashes}/${MAX_CONSECUTIVE_CRASHES}.`,
        );
      }

      if (!settled) {
        settled = true;
        // Died during startup, before 'ready'. This request never reached
        // `pending` (generate() awaits ensureWorker() first), so rejecting the
        // spawn promise is what surfaces it -- ensureWorker()'s catch clears
        // workerPromise so the next call still gets a fresh attempt.
        reject(
          new Error(
            `[llm] The inference process exited during startup (exit code ${code}). ` +
              `The model was not loaded and the AI request could not be started.`,
          ),
        );
      }

      failAllPending(
        new Error(
          intentional
            ? `[llm] The inference process was shut down before this request finished; the AI request was cancelled.`
            : `[llm] The inference process crashed (exit code ${code}). The AI request did not complete. ` +
              `Try again -- a fresh inference process will be started automatically.`,
        ),
      );
    });
  });

const ensureWorker = (): Promise<WorkerHandle> => {
  if (shuttingDown) {
    // A generate() that lands during teardown must not fork a process that
    // would outlive main -- exactly the orphan this part exists to prevent.
    return Promise.reject(
      new Error(
        '[llm] Fabrica is shutting down; no new AI request can be started.',
      ),
    );
  }

  if (consecutiveCrashes >= MAX_CONSECUTIVE_CRASHES) {
    return Promise.reject(
      new Error(
        `[llm] The inference process has crashed ${consecutiveCrashes} times in a row without ` +
          `completing a request, so it will not be restarted again automatically. This usually means ` +
          `the model file is corrupt or the GPU driver is failing. Restart Fabrica to try again.`,
      ),
    );
  }

  if (!workerPromise) {
    // Lazy: the model is not loaded, and no process is spawned, until the first
    // real generate() call -- same "first use pays" behaviour initLlama() had.
    // Also the respawn path: `workerPromise` is cleared whenever a worker dies,
    // so an ordinary retry after a crash lands here and forks a fresh process
    // with no special-casing at any call site.
    workerPromise = spawnWorker().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
};

// ---------------------------------------------------------------------------
// PART 2 work items 2 + 5: explicit teardown.
//
// ONE handler covers both cases, because electronmon's hot-reload restart is
// itself a graceful quit -- and that is the key finding that made this simple.
// On a main-file change electronmon does NOT signal or hard-kill the process:
// it sends 'reset' over IPC to the hook it injects with `--require`, and that
// hook calls `electron.app.quit()`
// (`node_modules/electronmon/src/hook.js`, `reset()` -> `exit(signal)`). So a
// file save runs the exact same 'before-quit' path as the user quitting the
// app, and both are covered here.
//
// Must stay SYNCHRONOUS. 'before-quit' does not await anything, and the
// electronmon hook additionally registers a 'will-quit' listener that calls
// `app.exit(37)` immediately -- so any teardown deferred past 'before-quit' is
// not guaranteed to run at all.
export const shutdownWorker = (reason = 'app quit'): void => {
  shuttingDown = true;

  if (workerBundleWatcher) {
    workerBundleWatcher.close();
    workerBundleWatcher = null;
  }

  const child = activeWorker;
  if (!child) {
    console.log(
      `[llm] worker teardown requested (${reason}) -- no live inference process to terminate.`,
    );
    return;
  }

  killWorker(child, reason);

  // Settled here rather than left to the async 'exit' event: main is about to
  // stop running JS, so that event may never be delivered. Callers get a
  // precise reason instead of a promise that dies with the process.
  failAllPending(
    new Error(
      `[llm] Fabrica is shutting down (${reason}); the AI request was cancelled.`,
    ),
  );
};

// ---------------------------------------------------------------------------
// The one contract that had to be preserved byte-for-byte.
export const generate = async (
  prompt: string,
  systemPrompt?: string,
  onTextChunk?: (text: string) => void,
  options?: {
    maxTokens?: number;
    contextSize?: number;
    priority?: GenerationPriority;
    signal?: AbortSignal;
    stopTriggers?: string[];
  },
): Promise<string> => {
  const { signal } = options ?? {};

  // Honour an already-aborted signal before anything is spawned or sent.
  // Without this an aborted caller could still pay a cold worker fork and the
  // ~14s model load measured in §9, only to be cancelled on arrival.
  if (signal?.aborted) {
    throw new GenerationAbortedError();
  }

  const child = await ensureWorker();
  requestSeq += 1;
  const id = requestSeq;

  return new Promise<string>((resolve, reject) => {
    const entry: PendingRequest = { resolve, reject, onTextChunk };
    pending.set(id, entry);

    // Fields are picked explicitly rather than spreading `options`: spreading
    // would carry `signal` onto the wire, and postMessage throws on a
    // non-cloneable value. PART 3 does not change that -- the signal is
    // flattened into a separate `cancel` message below, never serialized.
    const request: WorkerRequest = {
      type: 'generate',
      id,
      prompt,
      systemPrompt,
      options: options
        ? {
            maxTokens: options.maxTokens,
            contextSize: options.contextSize,
            priority: options.priority,
            stopTriggers: options.stopTriggers,
          }
        : undefined,
    };

    try {
      child.postMessage(request);
    } catch (err) {
      settlePending(id);
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    // -----------------------------------------------------------------------
    // PART 3: flatten the caller's AbortSignal into a `cancel(id)` message.
    //
    // Subscribed AFTER the generate has been posted, which the port's ordering
    // guarantee then turns into a correctness property: the worker cannot
    // receive a cancel for an id it has not already registered. Nothing can
    // interleave between the two in any case -- this executor is synchronous
    // throughout -- but the order is load-bearing rather than incidental, so it
    // is not left to chance.
    //
    // ONE SETTLEMENT AUTHORITY: aborting does NOT settle this promise here. It
    // only asks the worker to stop; the promise settles when the worker's reply
    // arrives, as a rehydrated GenerationAbortedError. Settling main-side on
    // abort would be worse in two concrete ways -- the worker would keep
    // generating into a promise nobody holds while still owning the
    // single-flight lock (blocking the NEXT request for the full remaining
    // generation), and a late 'done' for the same id would land after the
    // caller had already been told it was cancelled.
    if (signal) {
      const onAbort = () => {
        const cancel: WorkerRequest = { type: 'cancel', id };
        try {
          child.postMessage(cancel);
        } catch {
          // The worker is already gone. Its 'exit' handler owns settling every
          // outstanding request (PART 2), so there is nothing to do here and
          // nothing lost by swallowing this.
        }
      };

      signal.addEventListener('abort', onAbort, { once: true });
      entry.cleanup = () => signal.removeEventListener('abort', onAbort);
    }
  });
};
