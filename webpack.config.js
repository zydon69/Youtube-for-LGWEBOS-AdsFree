import CopyPlugin from 'copy-webpack-plugin';
import { TransformAsyncModulesPlugin } from 'transform-async-modules-webpack-plugin';
import TerserPlugin from 'terser-webpack-plugin';
import pkgJson from './package.json' with { type: 'json' };
import webpack from 'webpack';
import { createRequire } from 'node:module';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const { version: babelRuntimeVersion } = require('@babel/runtime/package.json');

/**
 * @param input {Buffer<ArrayBufferLike>}
 * @returns {string}
 */
function transformAppInfo(input) {
  const appInfo = JSON.parse(input.toString());
  if (appInfo.version !== pkgJson.version) {
    throw new Error('assets/appinfo.json version must match package.json');
  }
  return JSON.stringify(appInfo, null, 2);
}

/** @type {(env: Record<string, string | boolean>, argv: { mode?: string }) => (import('webpack').Configuration)[]} */
const makeConfig = (env = {}, argv) => [
  {
    /**
     * NOTE: Builds with devtool = 'eval' contain very big eval chunks which seem
     * to cause segfaults (at least) on nodeJS v0.12.2 used on webOS 3.x.
     */
    devtool: argv.mode === 'development' ? 'inline-source-map' : false,

    output: {
      clean: true,
      ...(typeof env.outputPath === 'string'
        ? { path: resolve(env.outputPath) }
        : {})
    },

    optimization: {
      chunkIds: 'deterministic',
      moduleIds: 'deterministic',
      /**
       * terser doesn't pickup browserlist config
       * See: https://github.com/terser/terser/issues/235
       */
      minimizer: [new TerserPlugin({ terserOptions: { ecma: 5 } })]
    },

    performance: {
      hints: 'error',
      maxAssetSize: 350 * 1024,
      maxEntrypointSize: 350 * 1024
    },

    entry: {
      index: './src/index.js',
      userScript: {
        import: './src/userScript',
        filename: 'webOSUserScripts/[name].js'
      }
    },

    resolve: {
      extensions: ['.mjs', '.cjs', '.js', '.json', '.ts']
    },

    module: {
      rules: [
        {
          test: /\.[mc]?[jt]s$/i,

          loader: 'babel-loader',
          exclude: [
            // Some module should not be transpiled by Babel
            // See https://github.com/zloirock/core-js/issues/743#issuecomment-572074215
            // \\ for Windows, / for macOS and Linux
            /node_modules[\\/]core-js/,
            /node_modules[\\/]webpack[\\/]buildin/
          ],
          options: {
            cacheDirectory: true
          },
          resolve: {
            // File extension DON'T MATTER in a bundler.
            fullySpecified: false
          }
        },
        {
          test: /\.css$/i,
          use: [
            { loader: 'style-loader' },
            {
              loader: 'css-loader',
              options: { esModule: false, importLoaders: 1 }
            },
            'postcss-loader'
          ]
        }
      ]
    },

    plugins: [
      new CopyPlugin({
        patterns: [
          {
            context: 'assets',
            from: '**/*',
            globOptions: { dot: false },
            transform: {
              transformer(input, absolutePath) {
                if (basename(absolutePath) === 'appinfo.json') {
                  return transformAppInfo(input);
                }
                return input;
              }
            }
          },
          { context: 'src', from: 'index.html' },
          { from: 'LICENSE' },
          { from: 'THIRD_PARTY_NOTICES.md' }
        ]
      }),
      // babel doesn't transform top-level await.
      // webpack transforms it to async modules.
      // This plugin calls babel again to transform remove the `async` keyword usage after the fact.
      new TransformAsyncModulesPlugin({
        runtime: {
          version: babelRuntimeVersion,
          absoluteRuntime: projectRoot
        }
      }),
      new webpack.DefinePlugin({
        __YTAF_VERSION__: JSON.stringify(pkgJson.version)
      })
    ]
  }
];

export default makeConfig;
