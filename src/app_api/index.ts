// Adapted from TizenTube's resolveCommand integration.

import { pollUntil } from '../core/poll';

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
    originalFn: ResolveCommand,
    payload: ResolveCommandPayload,
    extra: unknown
  ): unknown;
}

interface RegistryOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

let registry: ResolveCommandRegistry | null = null;
let registryPromise: Promise<ResolveCommandRegistry> | null = null;

export class ResolveCommandRegistry {
  #originalFn: ResolveCommand;
  #cmds = new Map<string, ResolveCommandHook>();

  private resolveCommand = (
    command: ResolveCommandPayload,
    extra?: unknown
  ) => {
    if (window.__ytaf_debug__) {
      console.debug(`[${this.constructor.name}] Resolving`, { command, extra });
    }

    for (const key of Object.keys(command)) {
      const hook = this.#cmds.get(key);
      if (hook) return hook(this.#originalFn, command, extra);
    }

    return this.#originalFn(command, extra);
  };

  private constructor(hookTargetName: string) {
    if (!ResolveCommandRegistry.checkHookTarget(hookTargetName)) {
      throw new Error(
        `Hook target "${hookTargetName}" not found in window._yttv`
      );
    }

    const hookTarget = window._yttv![hookTargetName] as {
      instance: { resolveCommand: ResolveCommand };
    };

    this.#originalFn = hookTarget.instance.resolveCommand.bind(
      hookTarget.instance
    );
    hookTarget.instance.resolveCommand = this.resolveCommand;
  }

  private static checkHookTarget(targetName: string) {
    const target = window._yttv?.[targetName];
    if (typeof target !== 'function' || !('instance' in target)) return false;

    const instance = target.instance;
    return (
      instance !== null &&
      typeof instance === 'object' &&
      typeof (instance as Record<string, unknown>).resolveCommand === 'function'
    );
  }

  private static findHookTarget() {
    if (!window._yttv || typeof window._yttv !== 'object') return null;

    for (const key of Object.keys(window._yttv)) {
      if (this.checkHookTarget(key)) return key;
    }

    return null;
  }

  private static waitForHookTarget({
    signal,
    timeoutMs = 15_000
  }: RegistryOptions = {}): Promise<string> {
    return pollUntil(() => this.findHookTarget(), {
      ...(signal ? { signal } : {}),
      timeoutMs,
      initialDelayMs: 50,
      maxDelayMs: 500,
      scheduler: window
    }) as Promise<string>;
  }

  static getInstance(options?: RegistryOptions) {
    if (registry) return Promise.resolve(registry);
    if (registryPromise) return registryPromise;

    registryPromise = this.waitForHookTarget(options)
      .then((key) => {
        registry ??= new ResolveCommandRegistry(key);
        return registry;
      })
      .finally(() => {
        registryPromise = null;
      });

    return registryPromise;
  }

  setHook(command: string, fn: ResolveCommandHook) {
    this.#cmds.set(command, fn);
  }

  removeHook(command: string) {
    this.#cmds.delete(command);
  }

  dispatchCommand(payload: ResolveCommandPayload, extra?: unknown) {
    return this.#originalFn(payload, extra);
  }
}
