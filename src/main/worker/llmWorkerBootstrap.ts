// ===========================================================================
// Crash-visibility shim for the inference utility process. DIAGNOSTIC ONLY --
// it adds no behaviour, owns no state, and speaks no part of the main<->worker
// protocol in `llmProtocol.ts`. Added 2026-08-22.
//
// Why it exists: `utilityProcess.fork()` gives main exactly ONE signal when a
// worker dies before its first message -- an exit code. A bad import, a
// throwing top-level statement, and a native module that fails to link all
// look identical from `llm.ts`: "exited during startup (exit code N)", no
// stack, no module name, nothing on stderr. This file is forked INSTEAD of
// `llmWorker.ts` and requires it, so anything that throws while
// `llmWorker.ts` is being evaluated is caught HERE -- in a process that has
// already installed its handlers -- and printed with a full stack.
//
// ORDER IS THE ENTIRE POINT: handlers first, boot line second, real module
// third. Registering the handlers after the require would leave uncovered the
// exact window this file exists to cover.
//
// NOTHING IN THIS FILE MAY IMPORT 'electron' -- same invariant as
// `llmWorker.ts`, for the same reason (a utility process guarantees only a
// Node environment plus `process.parentPort`). It imports nothing at all, in
// fact: even a builtin `import` is hoisted above the handlers by the module
// system, and "first" here is meant literally.
// ===========================================================================

// Webpack rewrites `__non_webpack_require__` into the runtime Node `require`.
// That is what makes the call below load the SIBLING `llmWorker` bundle that
// its own webpack entry emits, instead of webpack statically inlining a second
// copy of the whole worker into THIS bundle at build time (which is what a
// plain `require('./llmWorker')` would do -- leaving the real llmWorker bundle
// emitted but dead, and two copies to drift apart).
//
// Typed as a plain call signature rather than the ambient `NodeRequire`: it is
// a build-time intrinsic with no module to import it from, and the narrower
// type avoids depending on a global that eslint's no-undef cannot see.
declare const __non_webpack_require__: (moduleId: string) => unknown;

const LABEL = '[llmWorker BOOTSTRAP]';

const describe = (err: unknown): string => {
  if (err instanceof Error) return err.stack ?? `${err.name}: ${err.message}`;
  return String(err);
};

// ---------------------------------------------------------------------------
// 1. HANDLERS FIRST -- before the boot log, before the require, before
//    anything else this file does.

process.on('uncaughtException', (err) => {
  console.error(`${LABEL} uncaughtException:`, describe(err));
  // Exit 1, NEVER 0. `llm.ts`'s 'exit' handler has only the code to reason
  // from, so a nonzero code is what lets a real crash be told apart from a
  // clean exit going forward. (The worker's own parent-watchdog path in
  // llmWorker.ts deliberately keeps exit(0) -- that IS a clean exit.)
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(`${LABEL} unhandledRejection:`, describe(reason));
  process.exit(1);
});

// ---------------------------------------------------------------------------
// 2. Boot line, on BOTH streams.
//
// Duplicated on purpose, same reasoning as llmWorker.ts's own BOOT lines: main
// relays stdout and stderr through two separate pipes, and if only one of them
// is working this still proves the process reached JS execution at all -- the
// single most useful fact when a fork dies having printed nothing.
const bootLine = `${LABEL} attempting to load real worker module, pid=${process.pid}`;
console.log(bootLine);
console.error(bootLine);

// ---------------------------------------------------------------------------
// 3. Dynamic require in a try/catch.
//
// A static `import` would be hoisted above the handlers registered above by the
// module system, putting the throw back out of reach. The require has to run
// HERE, after step 1, for any of this to work -- that is why it is a require
// and not an import, and the reason is structural, not stylistic.
try {
  // Derived from our own filename rather than hardcoded, so one expression
  // covers both layouts: dev emits `llmWorkerBootstrap.bundle.dev.js` next to
  // `llmWorker.bundle.dev.js`, prod emits `llmWorkerBootstrap.js` next to
  // `llmWorker.js`. Both webpack main configs set `node: { __filename: false }`,
  // so __filename is the real on-disk path.
  const marker = 'llmWorkerBootstrap';
  const at = __filename.lastIndexOf(marker);
  if (at === -1) {
    throw new Error(
      `cannot derive the real worker module path: this bundle is "${__filename}", ` +
        `which does not contain "${marker}". The webpack entry KEY must stay ` +
        `\`llmWorkerBootstrap\` in webpack.config.main.dev.ts and .prod.ts.`,
    );
  }
  const realWorkerModule =
    __filename.slice(0, at) + 'llmWorker' + __filename.slice(at + marker.length);

  console.log(`${LABEL} requiring ${realWorkerModule}`);
  __non_webpack_require__(realWorkerModule);
  console.log(`${LABEL} real worker module loaded, pid=${process.pid}`);
} catch (err) {
  // The whole reason this file exists: a synchronous top-level throw inside
  // llmWorker.ts (bad import, bad top-level code, native module that will not
  // link) reaches main as a bare exit code with no stack. Now it reaches main
  // as a stack, on stderr, before the exit code.
  console.error(
    `${LABEL} FAILED to load the real worker module -- the inference process ` +
      `will now exit(1). Full error follows:`,
  );
  console.error(describe(err));
  process.exit(1);
}
