/* global document */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

test('DOM mutation coordinator shares delivery and fully disconnects', async () => {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    MutationObserver: globalThis.MutationObserver
  };
  const browser = new Window();
  globalThis.window = browser;
  globalThis.document = browser.document;
  globalThis.MutationObserver = browser.MutationObserver;

  try {
    const { subscribeDOMMutations, disconnectDOMMutationCoordinator } =
      await import('../src/core/dom-mutations.js');
    let firstCalls = 0;
    let secondCalls = 0;
    const stopFirst = subscribeDOMMutations((records) => {
      firstCalls++;
      assert.equal(records[0].type, 'childList');
    });
    subscribeDOMMutations(() => {
      secondCalls++;
    });

    document.body.appendChild(document.createElement('div'));
    await new Promise((resolve) => browser.setTimeout(resolve, 20));
    assert.equal(firstCalls, 1);
    assert.equal(secondCalls, 1);

    stopFirst();
    disconnectDOMMutationCoordinator();
    document.body.appendChild(document.createElement('span'));
    await new Promise((resolve) => browser.setTimeout(resolve, 20));
    assert.equal(firstCalls, 1);
    assert.equal(secondCalls, 1);
  } finally {
    await browser.close();
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.MutationObserver = previous.MutationObserver;
  }
});
