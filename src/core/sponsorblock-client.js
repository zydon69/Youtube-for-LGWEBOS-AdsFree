import { MAX_SPONSORBLOCK_RESPONSE_BYTES } from './sponsorblock-schema.js';
import { SPONSORBLOCK_ORIGIN } from './runtime-origins.js';

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 30_000;

/** @typedef {Error & { retryable?: boolean, retryAfterMs?: number }} RetryableError */

function abortError(message = 'SponsorBlock request aborted') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

/** @param {string} value */
function assertSponsorBlockURL(value) {
  const url = new URL(value);
  if (
    url.origin !== SPONSORBLOCK_ORIGIN ||
    !url.pathname.startsWith('/api/') ||
    url.username ||
    url.password
  ) {
    throw new TypeError('SponsorBlock request URL is not allowed');
  }
  return url.href;
}

/** @param {string} requestURL */
function assertSponsorBlockTransport(requestURL) {
  try {
    if (typeof Request !== 'function') throw new Error('Request unavailable');
    const probe = new Request(requestURL, {
      redirect: 'error',
      referrerPolicy: 'no-referrer'
    });
    if (probe.redirect !== 'error' || probe.referrerPolicy !== 'no-referrer') {
      throw new Error('policy options ignored');
    }
  } catch (cause) {
    /** @type {RetryableError} */
    const error = new Error(
      'SponsorBlock requires enforceable redirect and referrer policies',
      { cause }
    );
    error.retryable = false;
    throw error;
  }
}

/** @param {Response} response */
function assertSponsorBlockResponse(response) {
  if (!response.url) return;
  try {
    assertSponsorBlockURL(response.url);
  } catch (cause) {
    /** @type {RetryableError} */
    const error = new Error('SponsorBlock redirected outside its API', {
      cause
    });
    error.retryable = false;
    throw error;
  }
}

/** @param {number} milliseconds */
function jitter(milliseconds) {
  return Math.max(0, Math.round(milliseconds * (0.75 + Math.random() * 0.5)));
}

/** @param {number} status */
function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

/** @param {string | null | undefined} value */
function parseRetryAfter(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, MAX_RETRY_AFTER_MS);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.min(Math.max(0, timestamp - Date.now()), MAX_RETRY_AFTER_MS);
}

/** @param {Response} response @returns {RetryableError} */
function createHTTPError(response) {
  const status = response.status;
  /** @type {RetryableError} */
  const error = new Error(`SponsorBlock returned HTTP ${status}`);
  error.retryable = isRetryableStatus(status);
  if (status === 429 || status === 503) {
    const retryAfterMs = parseRetryAfter(
      response.headers?.get?.('retry-after') ?? null
    );
    if (retryAfterMs !== null) error.retryAfterMs = retryAfterMs;
  }
  return error;
}

/** @param {string} body @param {number} maximum */
function exceedsUTF8ByteLength(body, maximum) {
  let bytes = 0;
  for (let index = 0; index < body.length; index++) {
    const code = body.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = body.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else bytes += 3;
    } else bytes += 3;
    if (bytes > maximum) return true;
  }
  return false;
}

/** @param {Response} response */
async function readBoundedBody(response) {
  const rawLength = response.headers?.get?.('content-length');
  const contentLength =
    rawLength === null || rawLength === undefined ? null : Number(rawLength);
  if (
    contentLength !== null &&
    (!Number.isFinite(contentLength) || contentLength < 0)
  ) {
    throw new Error('SponsorBlock returned an invalid content length');
  }
  if (
    contentLength !== null &&
    contentLength > MAX_SPONSORBLOCK_RESPONSE_BYTES
  ) {
    throw new Error('SponsorBlock response is too large');
  }

  const reader = response.body?.getReader?.();
  if (reader && typeof TextDecoder === 'function') {
    const decoder = new TextDecoder();
    let size = 0;
    let body = '';
    try {
      while (true) {
        // Sequential reads are required by the ReadableStream contract.
        // eslint-disable-next-line no-await-in-loop
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_SPONSORBLOCK_RESPONSE_BYTES) {
          // eslint-disable-next-line no-await-in-loop
          await reader.cancel();
          throw new Error('SponsorBlock response is too large');
        }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
      return body;
    } finally {
      reader.releaseLock?.();
    }
  }

  // Legacy webOS fetch polyfills buffer before exposing Response.text(), and
  // older CORS implementations do not expose Content-Length. Content-Type is
  // safelisted, so require JSON before using that unavoidable buffered path.
  if (contentLength === null) {
    const contentType = response.headers?.get?.('content-type') ?? '';
    if (!/^application\/(?:[\w.+-]*\+)?json(?:\s*;|$)/i.test(contentType)) {
      throw new Error('SponsorBlock response size is unknown');
    }
  }
  const body = await response.text();
  if (exceedsUTF8ByteLength(body, MAX_SPONSORBLOCK_RESPONSE_BYTES)) {
    throw new Error('SponsorBlock response is too large');
  }
  return body;
}

/** @param {number} milliseconds @param {AbortSignal | undefined} signal */
function waitForRetry(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const token = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(undefined);
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(token);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * @param {string} url
 * @param {typeof fetch} fetchImpl
 * @param {{ signal?: AbortSignal, timeoutMs?: number }} options
 */
export async function fetchSponsorBlockJSON(
  url,
  fetchImpl = fetch,
  { signal: externalSignal, timeoutMs = REQUEST_TIMEOUT_MS } = {}
) {
  const requestURL = assertSponsorBlockURL(url);
  assertSponsorBlockTransport(requestURL);
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > REQUEST_TIMEOUT_MS
  ) {
    throw new RangeError(
      `timeoutMs must be between 1 and ${REQUEST_TIMEOUT_MS}`
    );
  }

  /** @param {number} attempt @returns {Promise<unknown>} */
  const request = async (attempt) => {
    if (externalSignal?.aborted) throw abortError();
    const controller =
      typeof AbortController === 'function' ? new AbortController() : null;
    /** @type {((error: Error) => void) | undefined} */
    let rejectOnExternalAbort;
    const abortRequest = () => {
      controller?.abort();
      rejectOnExternalAbort?.(abortError());
    };
    externalSignal?.addEventListener('abort', abortRequest, { once: true });
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timeoutToken;

    try {
      const requestSignal = controller?.signal ?? externalSignal;
      /** @type {RequestInit} */
      const requestOptions = {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        redirect: 'error',
        headers: { Accept: 'application/json' },
        ...(requestSignal ? { signal: requestSignal } : {})
      };
      const operation = (async () => {
        const response = await fetchImpl(requestURL, requestOptions);
        if (externalSignal?.aborted) throw abortError();
        assertSponsorBlockResponse(response);
        if (!response.ok) throw createHTTPError(response);
        const body = await readBoundedBody(response);
        if (externalSignal?.aborted) throw abortError();
        return JSON.parse(body);
      })();
      const result = await Promise.race([
        operation,
        new Promise((_, reject) => {
          timeoutToken = setTimeout(() => {
            controller?.abort();
            /** @type {RetryableError} */
            const error = new Error('SponsorBlock request timed out');
            error.retryable = controller !== null;
            reject(error);
          }, timeoutMs);
        }),
        new Promise((_, reject) => {
          rejectOnExternalAbort = reject;
        })
      ]);
      return result;
    } catch (error) {
      if (externalSignal?.aborted) throw abortError();
      let retryable = false;
      if (error instanceof Error) {
        const retryableError = /** @type {RetryableError} */ (error);
        retryable =
          retryableError.retryable === true ||
          error.name === 'AbortError' ||
          error.name === 'TypeError';
      }
      if (!retryable || attempt === MAX_ATTEMPTS - 1) throw error;
      const retryAfterMs =
        error instanceof Error
          ? /** @type {RetryableError} */ (error).retryAfterMs
          : undefined;
      await waitForRetry(
        retryAfterMs ?? jitter(250 * 2 ** attempt),
        externalSignal
      );
      return request(attempt + 1);
    } finally {
      clearTimeout(timeoutToken);
      externalSignal?.removeEventListener('abort', abortRequest);
    }
  };

  return request(0);
}
