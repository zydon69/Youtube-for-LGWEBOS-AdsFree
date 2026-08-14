import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

import {
  installDOMGlobals,
  registerCSSModuleStub
} from './helpers/dom-runtime.js';

registerCSSModuleStub();

test('watch construction rolls back DOM and timers when observation fails', async () => {
  const browser = new Window({ url: 'https://www.youtube.com/tv#/' });
  const restoreGlobals = installDOMGlobals(browser);
  browser.localStorage.setItem(
    'ytaf-configuration-v2',
    JSON.stringify({ showWatch: true })
  );

  const createdTimers = new Set();
  const clearedTimers = new Set();
  const nativeSetTimeout = browser.setTimeout.bind(browser);
  const nativeClearTimeout = browser.clearTimeout.bind(browser);
  browser.setTimeout = (callback, delay, ...args) => {
    const token = nativeSetTimeout(callback, delay, ...args);
    createdTimers.add(token);
    return token;
  };
  browser.clearTimeout = (token) => {
    clearedTimers.add(token);
    nativeClearTimeout(token);
  };
  globalThis.MutationObserver = class {
    observe() {
      throw new Error('observer unavailable');
    }

    disconnect() {}
  };

  try {
    const watch = await import('../src/watch.js');
    assert.throws(() => watch.installWatch(), /observer unavailable/);
    assert.equal(browser.document.querySelector('.webOs-watch'), null);
    assert.ok(createdTimers.size > 0);
    for (const token of createdTimers)
      assert.equal(clearedTimers.has(token), true);

    browser.dispatchEvent(new browser.Event('pageshow'));
    assert.equal(browser.document.querySelector('.webOs-watch'), null);
  } finally {
    for (const token of createdTimers) nativeClearTimeout(token);
    restoreGlobals();
    await browser.close();
  }
});
