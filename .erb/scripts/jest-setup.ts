// Jest setup, run before every test file (package.json -> jest.setupFiles).
//
// Replaces ERB's stock `check-build-exists.ts` in this slot. That file asserted
// that the webpack main/renderer bundles already existed and aborted the whole
// run otherwise, which is wrong for unit tests: `translateImports.ts` is pure
// string/regex code with no bundle behind it, so requiring a full `npm run
// build` before it can be tested is a false dependency. It also imported
// `chalk` purely to color that abort message, and chalk resolved to the ESM
// v5 copy under `release/app/node_modules` (a node-llama-cpp transitive dep)
// which Jest does not transform -- so every run died with
// "Cannot use import statement outside a module" before a single test ran.
//
// What actually needed keeping is the polyfill below. `check-build-exists.ts`
// is left on disk untouched and can still be wired into a build-dependent
// suite later if one ever exists.
import { TextEncoder, TextDecoder } from 'node:util';

// JSDOM does not implement TextEncoder and TextDecoder.
if (!global.TextEncoder) {
  global.TextEncoder = TextEncoder;
}
if (!global.TextDecoder) {
  // @ts-ignore -- Node's TextDecoder is structurally compatible enough here.
  global.TextDecoder = TextDecoder;
}
