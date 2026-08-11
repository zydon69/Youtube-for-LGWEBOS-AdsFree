import assert from 'node:assert/strict';
import test from 'node:test';

import { pollUntil } from '../src/core/poll.js';
import { waitForChildAdd } from '../src/utils.js';

test('polling is bounded and backs off', async () => {
  let calls = 0;
  await assert.rejects(
    pollUntil(
      () => {
        calls++;
        return null;
      },
      { timeoutMs: 20, initialDelayMs: 5, maxDelayMs: 10 }
    ),
    /timed out/
  );
  assert.ok(calls >= 2 && calls <= 6, `unexpected probe count: ${calls}`);
});

test('polling honors an already-aborted signal', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    pollUntil(() => 'never', { signal: controller.signal }),
    { name: 'AbortError' }
  );
});

test('polling rejects invalid bounds and probe failures', async () => {
  assert.throws(
    () => pollUntil(() => true, { initialDelayMs: 10, maxDelayMs: 5 }),
    RangeError
  );
  assert.throws(() => pollUntil(() => true, { timeoutMs: -1 }), RangeError);
  await assert.rejects(
    pollUntil(() => {
      throw new Error('probe failed');
    }),
    /probe failed/
  );
});

test('DOM waiting finds matches nested in an added subtree', async (context) => {
  const previousObserver = globalThis.MutationObserver;
  let callback;
  let disconnected = false;

  globalThis.MutationObserver = class {
    constructor(observerCallback) {
      callback = observerCallback;
    }

    observe() {}

    disconnect() {
      disconnected = true;
    }
  };
  context.after(() => {
    globalThis.MutationObserver = previousObserver;
  });

  const parent = { childNodes: [] };
  const target = { childNodes: [], matchesAuditTarget: true };
  const wrapper = { childNodes: [target] };
  const pending = waitForChildAdd(
    parent,
    (node) => node.matchesAuditTarget === true,
    { timeoutMs: 100 }
  );

  callback([{ type: 'childList', addedNodes: [wrapper] }]);
  assert.equal(await pending, target);
  assert.equal(disconnected, true);
});
