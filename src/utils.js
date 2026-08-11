import { buildLaunchURL, parseLaunchParams } from './core/launch.js';

export function extractLaunchParams() {
  return parseLaunchParams(window.launchParams);
}

/** @param {unknown} params */
export function handleLaunch(params) {
  const target = buildLaunchURL(params);
  console.info('[launch] Navigating to', target.href);
  window.location.assign(target.href);
}

/** @param {Node} root @param {(node: Node) => boolean} predicate */
function findMatch(root, predicate) {
  const stack = [root];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    if (predicate(node)) return node;

    if (!node?.childNodes) continue;
    for (let index = node.childNodes.length - 1; index >= 0; index--) {
      const child = node.childNodes[index];
      if (child) stack.push(child);
    }
  }

  return null;
}

/**
 * Wait for a matching node to appear below a parent.
 *
 * @template {Node} T
 * @param {Element} parent
 * @param {(node: Node) => node is T} predicate
 * @param {{ observeAttributes?: boolean, signal?: AbortSignal, timeoutMs?: number }} [options]
 * @returns {Promise<T>}
 */
export function waitForChildAdd(parent, predicate, options = {}) {
  const { observeAttributes = false, signal, timeoutMs = 15_000 } = options;

  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError('timeoutMs must be a finite non-negative number');
  }

  return new Promise((resolve, reject) => {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timeoutToken;
    let settled = false;

    const cleanup = () => {
      observer.disconnect();
      if (timeoutToken !== undefined) clearTimeout(timeoutToken);
      signal?.removeEventListener('abort', handleAbort);
    };

    /** @param {(value: any) => void} callback @param {any} value */
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };

    const handleAbort = () => {
      settle(reject, new DOMException('Operation aborted', 'AbortError'));
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && predicate(mutation.target)) {
          settle(resolve, mutation.target);
          return;
        }

        if (mutation.type !== 'childList') continue;
        for (const addedNode of mutation.addedNodes) {
          const match = findMatch(addedNode, predicate);
          if (match) {
            settle(resolve, match);
            return;
          }
        }
      }
    });

    if (signal?.aborted) {
      handleAbort();
      return;
    }

    signal?.addEventListener('abort', handleAbort, { once: true });
    try {
      observer.observe(parent, {
        subtree: true,
        attributes: observeAttributes,
        childList: true
      });
    } catch (error) {
      settle(reject, error);
      return;
    }

    // Close the race between the caller's first lookup and observer installation.
    const existing = findMatch(parent, predicate);
    if (existing) {
      settle(resolve, existing);
      return;
    }

    if (Number.isFinite(timeoutMs) && timeoutMs >= 0) {
      timeoutToken = setTimeout(() => {
        settle(
          reject,
          new Error(`Timed out after ${timeoutMs}ms waiting for a DOM node`)
        );
      }, timeoutMs);
    }
  });
}
