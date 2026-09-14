import fs from 'fs';
import path from 'path';
import webpackPaths from './webpack.paths';

const src = path.join(
  webpackPaths.rootPath,
  'node_modules',
  'monaco-editor',
  'min',
  'vs',
);
const dest = path.join(webpackPaths.distRendererPath, 'vs');

// monaco-editor's min/vs is a self-contained AMD bundle meant to be requested
// as static files by its own vs/loader.js, not run through webpack's
// require() -- importing it as a module resolves to that same CommonJS
// build, which breaks on require() calls webpack can't statically analyze
// ("Critical dependency: require function is used in a way in which
// dependencies cannot be statically extracted"). Copying it next to the
// renderer's index.html lets @monaco-editor/react's own loader
// (loader.config({ paths: { vs: 'vs' } }) in Editor.tsx) fetch it from disk
// instead of cdn.jsdelivr.net.
//
// Runs once per webpack process start (called at config-eval time, not from
// a compiler hook), guarded by an existence check so repeated dev rebuilds
// don't re-copy the ~28MB folder.
export default function copyMonacoVs() {
  if (fs.existsSync(path.join(dest, 'loader.js'))) return;
  fs.mkdirSync(webpackPaths.distRendererPath, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}
