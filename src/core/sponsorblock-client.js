import { MAX_SPONSORBLOCK_RESPONSE_BYTES } from './sponsorblock-schema.js';

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_ATTEMPTS = 3;

/** @typedef {Error & { retryable?: boolean }} RetryableError */

/** @param {number} status */
function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

/** @param {number} status @returns {RetryableError} */
function createHTTPError(status) {
  /** @type {RetryableError} */
  const error = new Error(`SponsorBlock returned HTTP ${status}`);
  error.retryable = isRetryableStatus(status);
  return error;
}

/** @param {string} url @param {typeof fetch} fetchImpl */
export async function fetchSponsorBlockJSON(url, fetchImpl = fetch) {
  /** @param {number} attempt @returns {Promise<unknown>} */
  const request = async (attempt) => {
    const controller =
      typeof AbortController === 'function' ? new AbortController() : null;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timeoutToken;

    try {
      const response = await Promise.race([
        fetchImpl(url, controller ? { signal: controller.signal } : undefined),
        new Promise((_, reject) => {
          timeoutToken = setTimeout(() => {
            controller?.abort();
            /** @type {RetryableError} */
            const error = new Error('SponsorBlock request timed out');
            error.retryable = controller !== null;
            reject(error);
          }, REQUEST_TIMEOUT_MS);
        })
      ]);

      if (!response.ok) throw createHTTPError(response.status);

      const contentLength = Number(response.headers?.get('content-length'));
      if (
        Number.isFinite(contentLength) &&
        contentLength > MAX_SPONSORBLOCK_RESPONSE_BYTES
      ) {
        throw new Error('SponsorBlock response is too large');
      }

      const body = await response.text();
      // UTF-8 uses at most three bytes per UTF-16 code unit.
      if (body.length * 3 > MAX_SPONSORBLOCK_RESPONSE_BYTES) {
        throw new Error('SponsorBlock response is too large');
      }
      return JSON.parse(body);
    } catch (error) {
      let retryable = false;
      if (error instanceof Error) {
        const retryableError = /** @type {RetryableError} */ (error);
        retryable =
          retryableError.retryable === true || error.name === 'AbortError';
      }
      if (!retryable || attempt === MAX_ATTEMPTS - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      return request(attempt + 1);
    } finally {
      clearTimeout(timeoutToken);
    }
  };

  return request(0);
}
