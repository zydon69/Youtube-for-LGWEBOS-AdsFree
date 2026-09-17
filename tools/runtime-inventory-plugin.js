import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import webpack from 'webpack';

/** Record packages with modules actually emitted into JavaScript chunks. */
export class RuntimeInventoryPlugin {
  /** @param {import('webpack').Compiler} compiler */
  apply(compiler) {
    compiler.hooks.thisCompilation.tap(
      'RuntimeInventoryPlugin',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'RuntimeInventoryPlugin',
            stage: webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT
          },
          () => {
            const packages = new Map();
            /** @param {import('webpack').Module} module */
            function collect(module) {
              const resource = /** @type {import('webpack').NormalModule} */ (
                module
              ).resource;
              if (resource && /[\\/]node_modules[\\/]/.test(resource)) {
                let directory = dirname(resource.split('?')[0] ?? resource);
                while (directory !== dirname(directory)) {
                  try {
                    const metadata = JSON.parse(
                      readFileSync(join(directory, 'package.json'), 'utf8')
                    );
                    if (
                      typeof metadata.name === 'string' &&
                      typeof metadata.version === 'string'
                    ) {
                      packages.set(`${metadata.name}@${metadata.version}`, {
                        name: metadata.name,
                        version: metadata.version
                      });
                      break;
                    }
                  } catch (error) {
                    if (!(
                      error &&
                      typeof error === 'object' &&
                      'code' in error &&
                      error.code === 'ENOENT'
                    ))
                      throw error;
                  }
                  directory = dirname(directory);
                }
              }
              const children =
                /** @type {{ modules?: Iterable<import('webpack').Module> }} */ (
                  module
                ).modules;
              if (children) for (const child of children) collect(child);
            }
            for (const module of compilation.modules) {
              if (compilation.chunkGraph.getNumberOfModuleChunks(module) > 0)
                collect(module);
            }
            compilation.emitAsset(
              'runtime-components.json',
              new webpack.sources.RawSource(
                `${JSON.stringify(
                  [...packages.values()].sort(
                    (a, b) =>
                      a.name.localeCompare(b.name) ||
                      a.version.localeCompare(b.version)
                  ),
                  null,
                  2
                )}\n`
              )
            );
          }
        );
      }
    );
  }
}
