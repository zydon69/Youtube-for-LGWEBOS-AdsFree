export type BootstrapDisposer = () => unknown;

export interface BootstrapModuleDescriptor {
  readonly name: string;
  readonly load: () => Promise<BootstrapDisposer | undefined>;
}

export interface BootstrapFailure {
  readonly name: string;
  readonly error: unknown;
}

export interface BootstrapReport {
  readonly loaded: readonly string[];
  readonly failures: readonly BootstrapFailure[];
  readonly aborted: boolean;
}

interface LoadedModule {
  readonly name: string;
  readonly dispose?: BootstrapDisposer;
}

export interface BootstrapLogger {
  error(message: string, error: unknown): void;
}

/** Type-safe adapter from a dynamic module import to a bootstrap descriptor. */
export function defineBootstrapModule<TModule>(
  name: string,
  load: () => Promise<TModule>,
  dispose?: (module: TModule) => unknown
): BootstrapModuleDescriptor {
  if (!name) throw new TypeError('Bootstrap module name is required');
  if (typeof load !== 'function') {
    throw new TypeError(`Bootstrap module "${name}" loader must be callable`);
  }
  if (dispose !== undefined && typeof dispose !== 'function') {
    throw new TypeError(`Bootstrap module "${name}" disposer must be callable`);
  }
  return {
    name,
    load: async () => {
      const module = await load();
      return dispose ? () => dispose(module) : undefined;
    }
  };
}

/**
 * Loads side-effect modules one at a time so a rejected module never prevents
 * unrelated modules from starting. Disposal is idempotent and runs in reverse
 * order for the infrastructure modules that expose an explicit rollback.
 */
export class IsolatedBootstrap {
  readonly #loadedModules: LoadedModule[] = [];
  readonly #logger: BootstrapLogger;
  #disposed = false;
  #started = false;

  constructor(logger: BootstrapLogger = console) {
    this.#logger = logger;
  }

  #disposeModule(name: string, dispose: BootstrapDisposer) {
    try {
      const result = dispose();
      if (
        result !== null &&
        (typeof result === 'object' || typeof result === 'function') &&
        typeof Reflect.get(result, 'then') === 'function'
      ) {
        void Promise.resolve(result).catch((error: unknown) => {
          this.#logger.error(`[bootstrap] Unable to dispose "${name}"`, error);
        });
      }
    } catch (error) {
      this.#logger.error(`[bootstrap] Unable to dispose "${name}"`, error);
    }
  }

  async #loadDescriptor(
    descriptor: BootstrapModuleDescriptor,
    loaded: string[],
    failures: BootstrapFailure[],
    signal?: AbortSignal
  ) {
    if (this.#disposed || signal?.aborted) return;

    try {
      const dispose = await descriptor.load();
      if (this.#disposed || signal?.aborted) {
        if (dispose) this.#disposeModule(descriptor.name, dispose);
        return;
      }

      this.#loadedModules.push({
        name: descriptor.name,
        ...(dispose ? { dispose } : {})
      });
      loaded.push(descriptor.name);
    } catch (error) {
      failures.push({ name: descriptor.name, error });
      this.#logger.error(
        `[bootstrap] Unable to load "${descriptor.name}"`,
        error
      );
    }
  }

  async run(
    descriptors: readonly BootstrapModuleDescriptor[],
    signal?: AbortSignal
  ): Promise<BootstrapReport> {
    if (this.#started) {
      throw new Error('Bootstrap has already started');
    }
    const names = new Set<string>();
    for (let index = 0; index < descriptors.length; index++) {
      const name = descriptors[index]?.name;
      if (!name || names.has(name)) {
        throw new Error(
          `Duplicate or invalid bootstrap module "${name ?? ''}"`
        );
      }
      names.add(name);
    }
    this.#started = true;

    const loaded: string[] = [];
    const failures: BootstrapFailure[] = [];

    await descriptors.reduce(
      (previous, descriptor) =>
        previous.then(() =>
          this.#loadDescriptor(descriptor, loaded, failures, signal)
        ),
      Promise.resolve()
    );

    return {
      loaded,
      failures,
      aborted: this.#disposed || signal?.aborted === true
    };
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;

    for (let index = this.#loadedModules.length - 1; index >= 0; index--) {
      const loaded = this.#loadedModules[index];
      if (!loaded?.dispose) continue;
      this.#disposeModule(loaded.name, loaded.dispose);
    }
    this.#loadedModules.length = 0;
  }
}
