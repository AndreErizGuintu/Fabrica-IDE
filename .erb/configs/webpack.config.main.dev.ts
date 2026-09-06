/**
 * Webpack config for development electron main process
 */

import path from 'path';
import webpack from 'webpack';
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer';
import { merge } from 'webpack-merge';
import checkNodeEnv from '../scripts/check-node-env';
import baseConfig from './webpack.config.base';
import webpackPaths from './webpack.paths';

// When an ESLint server is running, we can't set the NODE_ENV so we'll check if it's
// at the dev webpack config is not accidentally run in a production environment
if (process.env.NODE_ENV === 'production') {
  checkNodeEnv('development');
}

const configuration: webpack.Configuration = {
  devtool: 'inline-source-map',

  mode: 'development',

  target: 'electron-main',

  entry: {
    main: path.join(webpackPaths.srcMainPath, 'main.ts'),
    preload: path.join(webpackPaths.srcMainPath, 'preload.ts'),
    // FORK TARGET (2026-08-22). This -- not `llmWorker` below -- is what
    // `utilityProcess.fork()` in llm.ts points at. Emits
    // `.erb/dll/llmWorkerBootstrap.bundle.dev.js` via `[name].bundle.dev.js`
    // below, a sibling of the worker bundle, which is what lets the bootstrap
    // derive the worker's path from its own __filename with no isPackaged
    // branch. If you rename this entry KEY, change `marker` in
    // llmWorkerBootstrap.ts and DEV_WORKER_BUNDLE in llm.ts to match.
    llmWorkerBootstrap: path.join(
      webpackPaths.srcMainPath,
      'worker',
      'llmWorkerBootstrap.ts',
    ),
    // Inference utility process (PART 1 of the utility-process migration,
    // DECISIONS.md 2026-08-07 section 5, work item 1). Emitted alongside main as
    // `.erb/dll/llmWorker.bundle.dev.js` by the output config below, which is
    // exactly where `llm.ts`'s resolveWorkerPath() looks first (sibling of
    // main.bundle.dev.js, via __dirname).
    //
    // Shares this config with `main` on purpose: it inherits the same
    // `externals` from webpack.config.base.ts -- crucially `node-llama-cpp`,
    // which must stay external -- plus the same ts-loader rules. `target:
    // 'electron-main'` is harmless here because a utility process is an
    // Electron Node environment and llmWorker.ts imports no Electron API at all
    // (that invariant is what the whole split rests on).
    //
    // DEV ONLY for now. The matching entry in webpack.config.main.prod.ts is
    // PART 2 -- prod emits to a different directory AND a different filename
    // (`distMainPath/[name].js`), which is why resolveWorkerPath() branches on
    // app.isPackaged rather than assuming one layout.
    // Source moved to src/main/worker/ on 2026-08-10 (cosmetic only). The entry
    // KEY stays `llmWorker`, which is what `[name]` in `output.filename` below
    // resolves to -- so the emitted bundle is still
    // `.erb/dll/llmWorker.bundle.dev.js` and resolveWorkerPath() in llm.ts
    // needed no change. Entry key and source path are independent in webpack;
    // only the latter moved.
    //
    // STILL BUILT, NO LONGER FORKED (2026-08-22): the bootstrap entry above is
    // the fork target, and it require()s this bundle at runtime via
    // __non_webpack_require__. This entry must therefore stay -- dropping it
    // would leave the bootstrap requiring a file that no longer exists.
    llmWorker: path.join(webpackPaths.srcMainPath, 'worker', 'llmWorker.ts'),
  },

  output: {
    path: webpackPaths.dllPath,
    filename: '[name].bundle.dev.js',
    library: {
      type: 'umd',
    },
  },

  plugins: [
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    new BundleAnalyzerPlugin({
      analyzerMode: process.env.ANALYZE === 'true' ? 'server' : 'disabled',
      analyzerPort: 8888,
    }),

    new webpack.DefinePlugin({
      'process.type': '"browser"',
    }),
  ],

  /**
   * Disables webpack processing of __dirname and __filename.
   * If you run the bundle in node.js it falls back to these values of node.js.
   * https://github.com/webpack/webpack/issues/2010
   */
  node: {
    __dirname: false,
    __filename: false,
  },
};

export default merge(baseConfig, configuration);
