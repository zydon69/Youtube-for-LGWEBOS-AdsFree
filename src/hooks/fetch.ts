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

    this.#originalFetch = window.fetch.bind(window);
    window.fetch = this.#customFetch;
  }

  static async #dumpBody(resource: Request | Response) {
    const MAX_DEBUG_BODY_BYTES = 64 * 1024;
    if (
      !resource?.constructor?.name ||
      !['Request', 'Response'].includes(resource.constructor.name)
    )
      return null;

    const blob = await resource.clone().blob();
    if (!blob.size) return null;
    if (blob.size > MAX_DEBUG_BODY_BYTES) {
      return `[body omitted: ${blob.size} bytes]`;
    }

    const fr = new FileReader();

    const res = new Promise((resolve, reject) => {
      fr.addEventListener('load', () => {
        resolve(fr.result);
      });
      fr.addEventListener('error', () => reject(fr.error));
      fr.addEventListener('abort', () =>
        reject(new Error('Body read aborted'))
      );
    });

    fr.readAsDataURL(blob);

    return res;
  }

  #customFetch = async (resource: FetchTarget, init?: RequestInit) => {
    const requestID = this.#fetchCount++;
    if (window.__ytaf_debug__) {
      console.debug(`Request ${requestID}:`, resource);
      init && console.debug(`Options  ${requestID}:`, init);

      if (resource instanceof Request) {
        const reqBody = await FetchRegistry.#dumpBody(resource);
        reqBody && console.debug(`Request Body ${requestID}:`, reqBody);
      }
    }

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

    // @ts-expect-error
    const res = await this.#originalFetch(resource, init);

    if (window.__ytaf_debug__) {
      console.debug(`Response ${requestID}:`, res);

      const resBody = await FetchRegistry.#dumpBody(res);
      resBody && console.debug(`Response Body ${requestID}:`, resBody);
    }

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
