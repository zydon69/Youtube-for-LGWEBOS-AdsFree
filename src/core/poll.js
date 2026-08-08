/**
 * @template T
 * @param {() => T | null | undefined | false} probe
 * @param {{ signal?: AbortSignal, timeoutMs?: number, initialDelayMs?: number, maxDelayMs?: number, scheduler?: { setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout } }} [options]
 * @returns {Promise<T>}
 */
export function pollUntil(
  probe,
  {
    signal,
    timeoutMs = 15_000,
    initialDelayMs = 50,
    maxDelayMs = 500,
    scheduler = globalThis
  } = {}
) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let delayMs = initialDelayMs;
    let timer;
    let settled = false;

    const cleanup = () => {
      if (timer !== undefined) scheduler.clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    };

    const succeed = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const abort = () => {
      const error = new Error('Polling aborted');
      error.name = 'AbortError';
      fail(error);
    };

    const poll = () => {
      let value;
      try {
        value = probe();
      } catch (error) {
        fail(error);
        return;
      }

      if (value !== null && value !== undefined && value !== false) {
        succeed(value);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        fail(new Error(`Polling timed out after ${timeoutMs}ms`));
        return;
      }

      timer = scheduler.setTimeout(poll, delayMs);
      delayMs = Math.min(Math.ceil(delayMs * 1.5), maxDelayMs);
    };

    if (signal?.aborted) {
      abort();
      return;
    }

    signal?.addEventListener('abort', abort, { once: true });
    poll();
  });
}
