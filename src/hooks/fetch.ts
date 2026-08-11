import { CustomEventTarget, TypedCustomEvent } from '../custom-event-target';

export interface StringConvertible {
  toString(): string;
}

export type FetchTarget = Request | StringConvertible;

let registry: FetchRegistry | null = null;

export interface RequestInfo {
  url: URL;
  resource: FetchTarget;
  init?: RequestInit | undefined;
}

interface EventMap {
  request: TypedCustomEvent<RequestInfo, unknown, 'request'>;
  response: TypedCustomEvent<Response, unknown, 'response'>;
}

export class FetchRegistry extends CustomEventTarget<EventMap> {
  #originalFetch: typeof fetch;
  #fetchCount = 0;

  private constructor() {
    super();

    this.#originalFetch = window.fetch;
    window.fetch = this.#customFetch;
  }

  #customFetch = async (resource: FetchTarget, init?: RequestInit) => {
    const requestID = this.#fetchCount++;

    const url = new URL(
      resource instanceof Request ? resource.url : resource.toString(),
      document.location.href
    );
    const reqAllowed = this.dispatchEvent(
      new TypedCustomEvent('request', {
        detail: { url, resource, init },
        cancelable: true
      })
    );
    if (!reqAllowed) {
      console.info(
        `Fetch request ${requestID} was cancelled by listener.`,
        resource,
        init
      );
      throw new TypeError('Failed to fetch');
    }

    const res = await Reflect.apply(this.#originalFetch, window, [
      resource,
      init
    ] as Parameters<typeof fetch>);

    this.dispatchEvent(new TypedCustomEvent('response', { detail: res }));

    return res;
  };

  static getInstance() {
    if (!registry) {
      registry = new FetchRegistry();
    }
    return registry;
  }

  dispose() {
    if (window.fetch === this.#customFetch) window.fetch = this.#originalFetch;
    registry = null;
  }
}

registry = FetchRegistry.getInstance();
