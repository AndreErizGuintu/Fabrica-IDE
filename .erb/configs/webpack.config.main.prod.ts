/**
 * Webpack config for production electron main process
 */

import path from 'path';
import webpack from 'webpack';
import { merge } from 'webpack-merge';
import TerserPlugin from 'terser-webpack-plugin';
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer';
import baseConfig from './webpack.config.base';
import webpackPaths from './webpack.paths';
import checkNodeEnv from '../scripts/check-node-env';
import deleteSourceMaps from '../scripts/delete-source-maps';

checkNodeEnv('production');
deleteSourceMaps();

const configuration: webpack.Configuration = {
  devtool: 'source-map',

  mode: 'production',

  target: 'electron-main',

  entry: {
    main: path.join(webpackPaths.srcMainPath, 'main.ts'),
    preload: path.join(webpackPaths.srcMainPath, 'preload.ts'),
    // Inference utility process -- the packaged counterpart of the dev entry in
    // webpack.config.main.dev.ts (PART 2 of the utility-process migration,
    // DECISIONS.md §9). Same source file, same reasoning for sharing this
    // config (inherits `externals` from webpack.config.base.ts, so
    // `node-llama-cpp` stays external and its native .node binaries are
    // asarUnpack'd at package time, exactly as when the model lived in main).
    //
    // The ONLY difference from dev is where it lands, and it is the reason
    // resolveWorkerPath() in llm.ts branches on app.isPackaged rather than
    // assuming one layout: the `output` block below emits to
    // webpackPaths.distMainPath as `[name].js` (-> dist/main/llmWorker.js),
    // where dev emits to webpackPaths.dllPath as `[name].bundle.dev.js`.
    // Sibling-of-main.js holds in both, which is what that resolver relies on.
    // Source moved to src/main/worker/ on 2026-08-10 (cosmetic only). As in the
    // dev config, the entry KEY stays `llmWorker` -- that is what `[name]`
    // resolves to -- so this still emits dist/main/llmWorker.js and
    // resolveWorkerPath()'s packaged branch is untouched.
    llmWorker: path.join(webpackPaths.srcMainPath, 'worker', 'llmWorker.ts'),
  },

  output: {
    path: webpackPaths.distMainPath,
    filename: '[name].js',
    library: {
      type: 'umd',
    },
  },

  optimization: {
    minimizer: [
      new TerserPlugin({
        parallel: true,
      }),
    ],
  },

  plugins: [
    new BundleAnalyzerPlugin({
      analyzerMode: process.env.ANALYZE === 'true' ? 'server' : 'disabled',
      analyzerPort: 8888,
    }),

    /**
     * Create global constants which can be configured at compile time.
     *
     * Useful for allowing different behaviour between development builds and
     * release builds
     *
     * NODE_ENV should be production so that modules do not perform certain
     * development checks
     */
    new webpack.EnvironmentPlugin({
      NODE_ENV: 'production',
      DEBUG_PROD: false,
      START_MINIMIZED: false,
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
