// Typed compatibility boundary for YouTube TV's private resolveCommand API.

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

interface HookTarget {
  name: string;
  instance: Record<string, unknown> & { resolveCommand: ResolveCommand };
}

interface BoundTarget extends HookTarget {
  originalFn: ResolveCommand;
  wrapper: ResolveCommand;
}

let registry: ResolveCommandRegistry | null = null;
const MAX_YTTV_ENTRIES_TO_INSPECT = 256;
const MAX_RESOLVE_COMMAND_TARGETS = 8;
const MAX_TRANSFORMED_COMMANDS = 32;

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

export class ResolveCommandRegistry {
  #targets = new Map<HookTarget['instance'], BoundTarget>();
  #preferredNames: string[] = [];
  #cmds = new Map<string, ResolveCommandHook>();
  #synchronizationToken: number | null = null;
  #destroyed = false;

  private constructor(targets: HookTarget[]) {
    try {
      for (const target of targets) this.bindTarget(target);
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

  synchronizeTargets() {
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

  static getDeferredInstance() {
    if (registry) {
      registry.synchronizeTargets();
      return registry;
    }
    registry = new ResolveCommandRegistry(findHookTargets());
    return registry;
  }

  static destroyInstance() {
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
