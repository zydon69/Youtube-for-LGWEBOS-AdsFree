// Typed compatibility boundary for YouTube TV's private resolveCommand API.

import { pollUntil } from '../core/poll.js';

declare global {
  interface Window {
    _yttv?: Record<string, unknown>;
  }
}

export type ResolveCommandPayload = Record<string, unknown>;

interface ResolveCommand {
  (command: ResolveCommandPayload, extra?: unknown): unknown;
}

export interface ResolveCommandHook {
  (
    payload: ResolveCommandPayload,
    extra: unknown
  ): ResolveCommandPayload | ResolveCommandPayload[];
}

interface RegistryOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface HookTarget {
  name: string;
  instance: Record<string, unknown> & { resolveCommand: ResolveCommand };
}

interface BoundTarget extends HookTarget {
  originalFn: ResolveCommand;
  wrapper: ResolveCommand;
}

interface PendingRegistry {
  controller: AbortController | null;
  promise: Promise<ResolveCommandRegistry>;
}

let registry: ResolveCommandRegistry | null = null;
let pendingRegistry: PendingRegistry | null = null;
let registryGeneration = 0;
const MAX_YTTV_ENTRIES_TO_INSPECT = 256;
const MAX_RESOLVE_COMMAND_TARGETS = 8;
const MAX_TRANSFORMED_COMMANDS = 32;

function createAbortError(message: string) {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function isRecord(value: unknown): value is ResolveCommandPayload {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getHookTarget(
  namespace: Record<string, unknown>,
  name: string
): HookTarget | null {
  try {
    const target = namespace[name];
    if (typeof target !== 'function' || !('instance' in target)) return null;
    const instance = target.instance;
    if (
      instance === null ||
      typeof instance !== 'object' ||
      typeof (instance as Record<string, unknown>).resolveCommand !== 'function'
    ) {
      return null;
    }
    return {
      name,
      instance: instance as HookTarget['instance']
    };
  } catch (error) {
    console.warn(`[app-api] Unable to inspect _yttv.${name}`, error);
    return null;
  }
}

/** Return every unique compatible instance, preferring previously bound names. */
function findHookTargets(preferredNames: readonly string[] = []) {
  let namespace: Record<string, unknown>;
  let names: string[];
  try {
    if (!window._yttv || typeof window._yttv !== 'object') return [];
    namespace = window._yttv;
    names = Object.keys(namespace).slice(0, MAX_YTTV_ENTRIES_TO_INSPECT);
  } catch (error) {
    console.warn('[app-api] Unable to enumerate _yttv', error);
    return [];
  }
  const orderedNames = [
    ...preferredNames.filter((name) => names.includes(name)),
    ...names.filter((name) => !preferredNames.includes(name))
  ];
  const seen = new Set<object>();
  const targets: HookTarget[] = [];
  for (const name of orderedNames) {
    const target = getHookTarget(namespace, name);
    if (!target || seen.has(target.instance)) continue;
    seen.add(target.instance);
    targets.push(target);
    // Multiple private constructors can legitimately dispatch commands, but
    // wrapping an unbounded registry would amplify risk if YouTube's internals
    // change or the object is polluted. Eight unique targets covers the known
    // TV layouts while keeping synchronization work strictly bounded.
    if (targets.length >= MAX_RESOLVE_COMMAND_TARGETS) break;
  }
  return targets;
}

function withCallerControls<T>(
  promise: Promise<T>,
  { signal, timeoutMs }: RegistryOptions
) {
  if (signal?.aborted)
    return Promise.reject(createAbortError('Operation aborted'));
  if (
    timeoutMs !== undefined &&
    (!Number.isFinite(timeoutMs) || timeoutMs < 0)
  ) {
    return Promise.reject(
      new RangeError('timeoutMs must be a finite non-negative number')
    );
  }
  if (!signal && timeoutMs === undefined) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(createAbortError('Operation aborted'));
    const timeoutToken =
      timeoutMs === undefined
        ? null
        : window.setTimeout(
            () =>
              reject(
                new Error(`ResolveCommand timed out after ${timeoutMs}ms`)
              ),
            timeoutMs
          );
    signal?.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal?.removeEventListener('abort', abort);
      if (timeoutToken !== null) window.clearTimeout(timeoutToken);
    });
  });
}

export class ResolveCommandRegistry {
  #targets = new Map<HookTarget['instance'], BoundTarget>();
  #preferredNames: string[] = [];
  #cmds = new Map<string, ResolveCommandHook>();
  #synchronizationToken: number | null = null;
  #destroyed = false;

  private constructor(targets: HookTarget[], allowDeferred = false) {
    try {
      for (const target of targets) this.bindTarget(target);
      if (this.#targets.size === 0 && !allowDeferred) {
        throw new Error('No writable resolveCommand target was found');
      }
      this.#synchronizationToken = window.setInterval(
        () => this.synchronizeTargets(),
        2_000
      );
    } catch (error) {
      for (const [instance, target] of this.#targets) {
        try {
          if (instance.resolveCommand === target.wrapper) {
            instance.resolveCommand = target.originalFn;
          }
        } catch (rollbackError) {
          console.warn(
            `[app-api] Unable to roll back _yttv.${target.name}`,
            rollbackError
          );
        }
      }
      this.#targets.clear();
      throw error;
    }
  }

  private transformCommand(
    command: ResolveCommandPayload,
    extra: unknown
  ): ResolveCommandPayload[] {
    let payloads = [command];
    for (const [key, hook] of this.#cmds) {
      const transformed: ResolveCommandPayload[] = [];
      for (const payload of payloads) {
        if (!Object.hasOwn(payload, key)) {
          transformed.push(payload);
          continue;
        }

        try {
          const result = hook(payload, extra);
          if (Array.isArray(result)) {
            if (result.length === 0) continue;
            const valid = result.filter(isRecord);
            if (valid.length !== result.length) {
              console.error(
                `[app-api] Hook "${key}" returned invalid command payloads`
              );
            }
            const candidates = valid.length > 0 ? valid : [payload];
            const capacity = MAX_TRANSFORMED_COMMANDS - transformed.length;
            if (candidates.length > capacity) {
              console.error(
                `[app-api] Hook "${key}" exceeded the command expansion limit`
              );
            }
            transformed.push(...candidates.slice(0, Math.max(0, capacity)));
          } else if (isRecord(result)) {
            transformed.push(result);
          } else {
            console.error(
              `[app-api] Hook "${key}" returned an invalid command payload`
            );
            transformed.push(payload);
          }
        } catch (error) {
          // A feature hook must never prevent YouTube's native command from
          // executing. Preserve the current payload and continue the pipeline.
          console.error(`[app-api] Hook "${key}" failed`, error);
          transformed.push(payload);
        }
        if (transformed.length >= MAX_TRANSFORMED_COMMANDS) break;
      }
      payloads = transformed;
      if (payloads.length === 0) break;
    }
    return payloads;
  }

  private invokeTarget(
    target: BoundTarget,
    command: ResolveCommandPayload,
    extra: unknown
  ) {
    if (this.#targets.get(target.instance) !== target) {
      return Reflect.apply(target.originalFn, target.instance, [
        command,
        extra
      ]);
    }
    if (!isRecord(command)) {
      return Reflect.apply(target.originalFn, target.instance, [
        command,
        extra
      ]);
    }
    let result;
    for (const payload of this.transformCommand(command, extra)) {
      result = Reflect.apply(target.originalFn, target.instance, [
        payload,
        extra
      ]);
    }
    return result;
  }

  private createBinding(target: HookTarget, originalFn: ResolveCommand) {
    const binding = {
      ...target,
      originalFn,
      wrapper: undefined as unknown as ResolveCommand
    } satisfies BoundTarget;
    // The binding object is never mutated after publication. Host wrappers may
    // retain this generation safely while a later generation is installed.
    binding.wrapper = (command, extra) =>
      this.invokeTarget(binding, command, extra);
    return binding;
  }

  private bindTarget(target: HookTarget) {
    const existing = this.#targets.get(target.instance);
    if (existing) {
      existing.name = target.name;
      let current: ResolveCommand | null = null;
      try {
        current = target.instance.resolveCommand;
        if (current === existing.wrapper) return true;
        if (typeof current !== 'function') {
          this.#targets.delete(target.instance);
          return false;
        }
        const nextBinding = this.createBinding(target, current);
        target.instance.resolveCommand = nextBinding.wrapper;
        if (target.instance.resolveCommand !== nextBinding.wrapper) {
          throw new TypeError('Host altered the resolveCommand wrapper');
        }
        this.#targets.set(target.instance, nextBinding);
        return true;
      } catch (error) {
        try {
          if (current && target.instance.resolveCommand !== current) {
            target.instance.resolveCommand = current;
          }
        } catch (rollbackError) {
          console.warn(
            `[app-api] Unable to roll back _yttv.${target.name}`,
            rollbackError
          );
        }
        console.warn(`[app-api] Unable to rebind _yttv.${target.name}`, error);
        this.#targets.delete(target.instance);
        return false;
      }
    }

    let originalFn: ResolveCommand;
    try {
      originalFn = target.instance.resolveCommand;
      if (typeof originalFn !== 'function') return false;
    } catch (error) {
      console.warn(`[app-api] Unable to inspect _yttv.${target.name}`, error);
      return false;
    }
    const binding = this.createBinding(target, originalFn);
    try {
      target.instance.resolveCommand = binding.wrapper;
      if (target.instance.resolveCommand !== binding.wrapper) {
        throw new TypeError('Host altered the resolveCommand wrapper');
      }
    } catch (error) {
      try {
        if (target.instance.resolveCommand !== binding.originalFn) {
          target.instance.resolveCommand = binding.originalFn;
        }
      } catch (rollbackError) {
        console.warn(
          `[app-api] Unable to roll back _yttv.${target.name}`,
          rollbackError
        );
      }
      console.warn(`[app-api] Unable to bind _yttv.${target.name}`, error);
      return false;
    }
    this.#targets.set(target.instance, binding);
    if (!this.#preferredNames.includes(target.name)) {
      this.#preferredNames.push(target.name);
    }
    return true;
  }

  private synchronizeTargets() {
    if (this.#destroyed) return;
    const discovered = findHookTargets(this.#preferredNames);
    const activeInstances = new Set(
      discovered.map((target) => target.instance)
    );
    for (const target of discovered) this.bindTarget(target);

    for (const [instance, target] of this.#targets) {
      if (activeInstances.has(instance)) continue;
      try {
        if (instance.resolveCommand === target.wrapper) {
          instance.resolveCommand = target.originalFn;
        }
      } catch (error) {
        console.warn(
          `[app-api] Unable to restore removed _yttv.${target.name}`,
          error
        );
      }
      this.#targets.delete(instance);
    }
  }

  private static waitForHookTargets(
    generation: number,
    { signal, timeoutMs = 24 * 60 * 60 * 1000 }: RegistryOptions = {}
  ) {
    return pollUntil(
      () => {
        if (generation !== registryGeneration) {
          throw createAbortError('ResolveCommand initialization cancelled');
        }
        const targets = findHookTargets();
        return targets.length > 0 ? targets : null;
      },
      {
        ...(signal ? { signal } : {}),
        timeoutMs,
        initialDelayMs: 50,
        maxDelayMs: 1_000,
        scheduler: window
      }
    ) as Promise<HookTarget[]>;
  }

  static async getInstance(options: RegistryOptions = {}) {
    if (options.signal?.aborted) {
      throw createAbortError('Operation aborted');
    }
    if (registry) {
      registry.synchronizeTargets();
      return registry;
    }

    if (!pendingRegistry) {
      const generation = registryGeneration;
      const controller =
        typeof AbortController === 'function' ? new AbortController() : null;
      const pending = this.waitForHookTargets(generation, {
        ...(controller ? { signal: controller.signal } : {})
      })
        .then((targets) => {
          if (generation !== registryGeneration) {
            throw createAbortError('ResolveCommand initialization cancelled');
          }
          registry ??= new ResolveCommandRegistry(targets);
          return registry;
        })
        .finally(() => {
          if (pendingRegistry?.promise === pending) pendingRegistry = null;
        });
      pendingRegistry = { controller, promise: pending };
    }

    return withCallerControls(pendingRegistry.promise, options);
  }

  static getDeferredInstance() {
    if (registry) {
      registry.synchronizeTargets();
      return registry;
    }
    pendingRegistry?.controller?.abort();
    pendingRegistry = null;
    registry = new ResolveCommandRegistry(findHookTargets(), true);
    return registry;
  }

  static destroyInstance() {
    registryGeneration++;
    pendingRegistry?.controller?.abort();
    pendingRegistry = null;
    registry?.destroy();
    registry = null;
  }

  setHook(command: string, fn: ResolveCommandHook) {
    if (this.#destroyed)
      throw new Error('ResolveCommand registry is destroyed');
    if (!command || typeof fn !== 'function') {
      throw new TypeError('resolveCommand hook name and callback are required');
    }
    if (this.#cmds.has(command)) {
      throw new Error(`resolveCommand hook "${command}" already registered`);
    }
    this.#cmds.set(command, fn);
  }

  removeHook(command: string) {
    this.#cmds.delete(command);
  }

  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    if (this.#synchronizationToken !== null) {
      window.clearInterval(this.#synchronizationToken);
      this.#synchronizationToken = null;
    }
    for (const [instance, target] of this.#targets) {
      try {
        if (instance.resolveCommand === target.wrapper) {
          instance.resolveCommand = target.originalFn;
        }
      } catch (error) {
        console.warn(`[app-api] Unable to restore _yttv.${target.name}`, error);
      }
    }
    this.#targets.clear();
    this.#cmds.clear();
    if (registry === this) registry = null;
  }
}

export function dispose() {
  ResolveCommandRegistry.destroyInstance();
}
