/**
 * One body-subtree observer shared by features that only need child-list
 * notifications. Each subscriber owns its debounce and can unsubscribe.
 */

const DEFAULT_MAX_PENDING_RECORDS = 128;

/** @typedef {{ overflowed: boolean }} MutationBatchMetadata */
/** @typedef {{ callback: (records: MutationRecord[], metadata: MutationBatchMetadata) => void, delayMs: number, maxPendingRecords: number, records: MutationRecord[], overflowed: boolean, token: number | null }} Subscription */

/** @type {Set<Subscription>} */
const subscriptions = new Set();
/** @type {MutationObserver | null} */
let observer = null;
let waitingForDocument = false;

function handleDocumentReady() {
  waitingForDocument = false;
  startObserver();
}

/** @param {MutationRecord[]} records */
function dispatch(records) {
  for (const subscription of subscriptions) {
    const remainingCapacity =
      subscription.maxPendingRecords - subscription.records.length;
    if (records.length > remainingCapacity) subscription.overflowed = true;
    if (remainingCapacity > 0) {
      // Keep the newest records: callers can rescan when metadata.overflowed is
      // true, while memory remains bounded during mutation storms.
      subscription.records.push(...records.slice(-remainingCapacity));
    }
    if (subscription.token !== null) continue;
    subscription.token = window.setTimeout(() => {
      subscription.token = null;
      const pending = subscription.records.splice(0);
      const metadata = { overflowed: subscription.overflowed };
      subscription.overflowed = false;
      try {
        subscription.callback(pending, metadata);
      } catch (error) {
        console.error('[dom] Mutation subscriber failed', error);
      }
    }, subscription.delayMs);
  }
}

function startObserver() {
  if (observer || subscriptions.size === 0) return;
  const root = document.documentElement;
  if (!root) {
    if (!waitingForDocument) {
      waitingForDocument = true;
      document.addEventListener('DOMContentLoaded', handleDocumentReady, {
        once: true
      });
    }
    return;
  }
  const nextObserver = new MutationObserver(dispatch);
  // Observing <html> rather than the current <body> keeps subscriptions alive
  // when YouTube replaces the body element during an application transition.
  nextObserver.observe(root, { childList: true, subtree: true });
  observer = nextObserver;
}

/**
 * @param {(records: MutationRecord[], metadata: MutationBatchMetadata) => void} callback
 * @param {{ delayMs?: number, maxPendingRecords?: number }} [options]
 */
export function subscribeDOMMutations(
  callback,
  { delayMs = 0, maxPendingRecords = DEFAULT_MAX_PENDING_RECORDS } = {}
) {
  if (typeof callback !== 'function')
    throw new TypeError('callback is required');
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new RangeError('delayMs must be a finite non-negative number');
  }
  if (
    !Number.isSafeInteger(maxPendingRecords) ||
    maxPendingRecords <= 0 ||
    maxPendingRecords > 4_096
  ) {
    throw new RangeError(
      'maxPendingRecords must be an integer between 1 and 4096'
    );
  }
  const subscription = {
    callback,
    delayMs,
    maxPendingRecords,
    records: [],
    overflowed: false,
    token: null
  };
  subscriptions.add(subscription);
  try {
    startObserver();
  } catch (error) {
    subscriptions.delete(subscription);
    throw error;
  }

  return () => {
    if (!subscriptions.delete(subscription)) return;
    if (subscription.token !== null) window.clearTimeout(subscription.token);
    subscription.records.length = 0;
    subscription.overflowed = false;
    if (subscriptions.size === 0) {
      observer?.disconnect();
      observer = null;
      if (waitingForDocument) {
        document.removeEventListener('DOMContentLoaded', handleDocumentReady);
        waitingForDocument = false;
      }
    }
  };
}

export function disconnectDOMMutationCoordinator() {
  for (const subscription of subscriptions) {
    if (subscription.token !== null) window.clearTimeout(subscription.token);
    subscription.records.length = 0;
    subscription.overflowed = false;
  }
  subscriptions.clear();
  observer?.disconnect();
  observer = null;
  if (waitingForDocument) {
    document.removeEventListener('DOMContentLoaded', handleDocumentReady);
    waitingForDocument = false;
  }
}
