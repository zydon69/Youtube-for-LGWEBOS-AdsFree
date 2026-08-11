import { CustomEventTarget, TypedCustomEvent } from '../custom-event-target.ts';

export interface StringConvertible {
  toString(): string;
}

export type FetchTarget = Request | URL | StringConvertible;

export interface FetchWindow {
  fetch: typeof fetch;
  readonly location?: { readonly href: string };
}

let registry: FetchRegistry | null = null;

export interface FetchRequestInfo {
  url: URL;
  resource: FetchTarget;
  init?: RequestInit | undefined;
}

interface EventMap {
  request: TypedCustomEvent<FetchRequestInfo, unknown, 'request'>;
  response: TypedCustomEvent<Response, unknown, 'response'>;
}

function resourceURL(resource: FetchTarget, baseURL: string) {
  if (resource !== null && typeof resource === 'object') {
    const url = Reflect.get(resource, 'url');
    if (typeof url === 'string') return new URL(url, baseURL);
  }
  return new URL(String(resource), baseURL);
}

function getBaseURL(target: FetchWindow) {
  const href =
    target.location?.href ??
    (typeof document === 'undefined' ? undefined : document.location?.href);
  if (!href) throw new TypeError('Unable to resolve fetch URL without a base');
  return href;
}

export class FetchRegistry extends CustomEventTarget<EventMap> {
  readonly #target: FetchWindow;
  #originalFetch: typeof fetch;
  #disposed = false;

  private constructor(target: FetchWindow) {
    super();
    if (typeof target.fetch !== 'function') {
      throw new TypeError('Fetch hook target must expose a fetch function');
    }
    this.#target = target;
    this.#originalFetch = target.fetch;
    try {
      target.fetch = this.#customFetch;
      if (target.fetch !== this.#customFetch) {
        throw new TypeError('Unable to bind fetch hook');
      }
    } catch (error) {
      try {
        if (target.fetch !== this.#originalFetch) {
          target.fetch = this.#originalFetch;
        }
      } catch (rollbackError) {
        console.warn('[fetch] Unable to roll back fetch hook', rollbackError);
      }
      throw error;
    }
  }

  #customFetch = async (resource: FetchTarget, init?: RequestInit) => {
    const url = resourceURL(resource, getBaseURL(this.#target));
    const reqAllowed = this.dispatchEvent(
      new TypedCustomEvent('request', {
        detail: { url, resource, init },
        cancelable: true
      })
    );
    if (!reqAllowed) throw new TypeError('Failed to fetch');

    const response = await Reflect.apply(this.#originalFetch, this.#target, [
      resource,
      init
    ] as Parameters<typeof fetch>);
    this.dispatchEvent(new TypedCustomEvent('response', { detail: response }));
    return response;
  };

  private owns(target: FetchWindow) {
    return this.#target === target;
  }

  /**
   * Reinstall the hook after the host replaces fetch. The replacement becomes
   * the new delegate, so disposing still restores the exact host function.
   */
  synchronize() {
    if (this.#disposed) throw new Error('Fetch registry is disposed');
    if (this.#target.fetch === this.#customFetch) return;
    if (typeof this.#target.fetch !== 'function') {
      throw new TypeError('Fetch replacement must be callable');
    }
    const replacement = this.#target.fetch;
    try {
      this.#target.fetch = this.#customFetch;
      if (this.#target.fetch !== this.#customFetch) {
        throw new TypeError('Unable to bind fetch replacement hook');
      }
    } catch (error) {
      try {
        if (this.#target.fetch !== replacement) {
          this.#target.fetch = replacement;
        }
      } catch (rollbackError) {
        console.warn(
          '[fetch] Unable to roll back fetch replacement hook',
          rollbackError
        );
      }
      throw error;
    }
    this.#originalFetch = replacement;
  }

  static getInstance(target: FetchWindow = window) {
    if (registry && !registry.owns(target)) registry.dispose();
    registry ??= new FetchRegistry(target);
    registry.synchronize();
    return registry;
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    try {
      if (this.#target.fetch === this.#customFetch) {
        this.#target.fetch = this.#originalFetch;
      }
    } catch (error) {
      console.warn('[fetch] Unable to restore host fetch', error);
    } finally {
      this.clearEventListeners();
      if (registry === this) registry = null;
    }
  }
}

export function disposeFetchRegistry() {
  registry?.dispose();
}

if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
  registry = FetchRegistry.getInstance(window);
}
