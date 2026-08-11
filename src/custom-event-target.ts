/**
 * Small EventTarget-compatible dispatcher for legacy webOS engines.
 *
 * Native EventTarget was not constructible on the Safari/Chromium versions
 * shipped by older TVs. Keeping the dispatcher local also avoids patching DOM
 * prototypes and gives every feature an explicit lifecycle.
 */

interface EmptyEventMap {}

interface EventLike {
  readonly type: string;
  readonly defaultPrevented?: boolean;
  currentTarget?: unknown;
}

type Listener<E> =
  ((event: E) => void) | { handleEvent(event: E): void } | null;

export interface TypedCustomEvent<D, T = unknown, U extends string = string> {
  readonly type: U;
  readonly detail: D;
  readonly cancelable: boolean;
  readonly defaultPrevented: boolean;
  readonly currentTarget: T | null;
  preventDefault(): void;
}

class LegacyCustomEvent<
  D,
  U extends string = string
> implements TypedCustomEvent<D, unknown, U> {
  readonly type: U;
  readonly detail: D;
  readonly cancelable: boolean;
  defaultPrevented = false;
  currentTarget: unknown = null;

  constructor(type: U, options: { detail?: D; cancelable?: boolean } = {}) {
    this.type = type;
    this.detail = options.detail as D;
    this.cancelable = options.cancelable === true;
  }

  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }
}

export const TypedCustomEvent = LegacyCustomEvent;

export type TypedEvent<T, U> = {
  readonly currentTarget: T | null;
  readonly type: U;
};

export class CustomEventTarget<
  T extends EmptyEventMap & { [K in keyof T]: EventLike }
> {
  readonly #listeners: Partial<{
    [K in keyof T]: Array<Listener<T[K]>>;
  }> = {};

  addEventListener<K extends keyof T & string>(
    type: K,
    callback: Listener<T[K]>
  ) {
    if (!callback) return;
    const listeners = (this.#listeners[type] ??= []);
    if (!listeners.includes(callback)) listeners.push(callback);
  }

  removeEventListener<K extends keyof T & string>(
    type: K,
    callback: Listener<T[K]>
  ) {
    const listeners = this.#listeners[type];
    if (!listeners || !callback) return;
    const index = listeners.indexOf(callback);
    if (index >= 0) listeners.splice(index, 1);
  }

  clearEventListeners() {
    for (const type of Object.keys(this.#listeners) as Array<keyof T>) {
      delete this.#listeners[type];
    }
  }

  dispatchEvent<K extends keyof T & string>(event: T[K]) {
    const listeners = [...(this.#listeners[event.type as K] ?? [])];
    const mutableEvent = event as T[K] & EventLike;
    mutableEvent.currentTarget = this;

    try {
      for (const listener of listeners) {
        try {
          if (typeof listener === 'function') listener.call(this, event);
          else listener?.handleEvent(mutableEvent);
        } catch (error) {
          // Match EventTarget: report the failure, continue dispatching, and do
          // not turn an observer failure into a caller failure.
          console.error('[events] Unhandled listener error', error);
        }
      }
    } finally {
      mutableEvent.currentTarget = null;
    }
    return mutableEvent.defaultPrevented !== true;
  }
}

export type EventMapOf<T> = T extends CustomEventTarget<infer U> ? U : never;
