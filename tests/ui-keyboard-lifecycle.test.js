import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

import {
  installDOMGlobals,
  registerCSSModuleStub
} from './helpers/dom-runtime.js';

registerCSSModuleStub();

test('the legacy blue-key alias does not consume slash in editable fields', async () => {
  const browser = new Window({ url: 'https://www.youtube.com/tv#/' });
  const restoreGlobals = installDOMGlobals(browser);
  globalThis.__YTAF_VERSION__ = 'audit-test';
  browser.__spatialNavigation__ = { keyMode: 'ARROW' };
  let ui;
  try {
    ui = await import('../src/ui.js');
    ui.installUI();
    const input = browser.document.createElement('input');
    browser.document.body.appendChild(input);
    input.focus();
    const slash = new browser.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: '/'
    });
    Object.defineProperty(slash, 'keyCode', { value: 191 });
    input.dispatchEvent(slash);
    assert.equal(slash.defaultPrevented, false);
  } finally {
    ui?.dispose();
    delete globalThis.__YTAF_VERSION__;
    restoreGlobals();
    await browser.close();
  }
});
