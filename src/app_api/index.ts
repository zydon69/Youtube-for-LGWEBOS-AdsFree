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

let registry: ResolveCommandRegistry | null = null;

function getHookTarget(name: string): HookTarget | null {
  const target = window._yttv?.[name];
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
}

function findUnambiguousHookTarget(preferredName?: string) {
  if (preferredName) {
    const preferred = getHookTarget(preferredName);
    if (preferred) return preferred;
  }
  if (!window._yttv || typeof window._yttv !== 'object') return null;

  const candidates = Object.keys(window._yttv)
    .map(getHookTarget)
    .filter((target): target is HookTarget => target !== null);
  return candidates.length === 1 ? candidates[0] : null;
}

export class ResolveCommandRegistry {
  #originalFn: ResolveCommand;
  #targetName: string;
  #targetInstance: HookTarget['instance'];
  #cmds = new Map<string, ResolveCommandHook>();
  #synchronizationToken: number;

  private resolveCommand = (
    command: ResolveCommandPayload,
    extra?: unknown
  ) => {
    let payloads = [command];
    for (const key of Object.keys(command)) {
      const hook = this.#cmds.get(key);
      if (!hook) continue;
      const transformed: ResolveCommandPayload[] = [];
      for (const payload of payloads) {
        if (!Object.hasOwn(payload, key)) {
          transformed.push(payload);
          continue;
        }
        const result = hook(payload, extra);
        transformed.push(...(Array.isArray(result) ? result : [result]));
      }
      payloads = transformed;
    }

    let result;
    for (const payload of payloads) {
      result = Reflect.apply(this.#originalFn, this.#targetInstance, [
        payload,
        extra
      ]);
    }
    return result;
  };

  private constructor(target: HookTarget) {
    this.#targetName = target.name;
    this.#targetInstance = target.instance;
    this.#originalFn = target.instance.resolveCommand;
    target.instance.resolveCommand = this.resolveCommand;
    this.#synchronizationToken = window.setInterval(
      () => this.synchronizeTarget(),
      2_000
    );
  }

  private synchronizeTarget() {
    const target = findUnambiguousHookTarget(this.#targetName);
    if (!target || target.instance === this.#targetInstance) return;

    if (this.#targetInstance.resolveCommand === this.resolveCommand) {
      this.#targetInstance.resolveCommand = this.#originalFn;
    }
    this.#targetName = target.name;
    this.#targetInstance = target.instance;
    this.#originalFn = target.instance.resolveCommand;
    target.instance.resolveCommand = this.resolveCommand;
  }

  private static waitForHookTarget({
    signal,
    timeoutMs = 24 * 60 * 60 * 1000
  }: RegistryOptions = {}) {
    return pollUntil(() => findUnambiguousHookTarget(), {
      ...(signal ? { signal } : {}),
      timeoutMs,
      initialDelayMs: 50,
      maxDelayMs: 1_000,
      scheduler: window
    }) as Promise<HookTarget>;
  }

  static async getInstance(options?: RegistryOptions) {
    if (registry) {
      registry.synchronizeTarget();
      return registry;
    }
    const target = await this.waitForHookTarget(options);
    registry ??= new ResolveCommandRegistry(target);
    return registry;
  }

  static destroyInstance() {
    registry?.destroy();
  }

  setHook(command: string, fn: ResolveCommandHook) {
    if (this.#cmds.has(command)) {
      throw new Error(`resolveCommand hook "${command}" already registered`);
    }
    this.#cmds.set(command, fn);
  }

  removeHook(command: string) {
    this.#cmds.delete(command);
  }

  dispatchCommand(payload: ResolveCommandPayload, extra?: unknown) {
    return Reflect.apply(this.#originalFn, this.#targetInstance, [
      payload,
      extra
    ]);
  }

  destroy() {
    window.clearInterval(this.#synchronizationToken);
    if (this.#targetInstance.resolveCommand === this.resolveCommand) {
      this.#targetInstance.resolveCommand = this.#originalFn;
    }
    this.#cmds.clear();
    registry = null;
  }
}
