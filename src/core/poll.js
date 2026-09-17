/**
 * @template T
 * @param {() => T | null | undefined | false} probe
 * @param {{ signal?: AbortSignal, timeoutMs?: number, initialDelayMs?: number, maxDelayMs?: number, scheduler?: { setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout } }} [options]
 * @returns {{ promise: Promise<T>, cancel: () => void }}
 */
export function startPolling(
  probe,
  {
    signal,
    timeoutMs = 15_000,
    initialDelayMs = 50,
    maxDelayMs = 500,
    scheduler = globalThis
  } = {}
) {
  /** @param {string} name @param {number} value */
  const validateDelay = (name, value, allowZero = false) => {
    if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
      throw new RangeError(
        `${name} must be a finite ${allowZero ? 'non-negative' : 'positive'} number`
      );
    }
  };
  validateDelay('timeoutMs', timeoutMs, true);
  validateDelay('initialDelayMs', initialDelayMs);
  validateDelay('maxDelayMs', maxDelayMs);
  if (maxDelayMs < initialDelayMs) {
    throw new RangeError('maxDelayMs must be greater than initialDelayMs');
  }

  let cancel = () => {};
  /** @type {Promise<T>} */
  const promise = new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let delayMs = initialDelayMs;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    let settled = false;

    const cleanup = () => {
      if (timer !== undefined) scheduler.clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    };

    /** @param {T} value */
    const succeed = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    /** @param {unknown} error */
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

    cancel = abort;

    const poll = () => {
      if (settled) return;
      let value;
      try {
        value = probe();
      } catch (error) {
        fail(error);
        return;
      }

      if (settled) return;

      if (value !== null && value !== undefined && value !== false) {
        succeed(value);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        fail(new Error(`Polling timed out after ${timeoutMs}ms`));
        return;
      }

      try {
        timer = scheduler.setTimeout(
          poll,
          Math.min(delayMs, timeoutMs - (Date.now() - startedAt))
        );
        delayMs = Math.min(Math.ceil(delayMs * 1.5), maxDelayMs);
      } catch (error) {
        fail(error);
      }
    };

    if (signal?.aborted) {
      abort();
      return;
    }

    signal?.addEventListener('abort', abort, { once: true });
    poll();
  });
  return { promise, cancel };
}

/**
 * Promise-only adapter for callers that use an AbortSignal or a timeout.
 * @template T
 * @param {() => T | null | undefined | false} probe
 * @param {Parameters<typeof startPolling>[1]} [options]
 * @returns {Promise<T>}
 */
export function pollUntil(probe, options) {
  return startPolling(probe, options).promise;
}
