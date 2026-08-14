import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

import {
  installDOMGlobals,
  registerCSSModuleStub
} from './helpers/dom-runtime.js';

registerCSSModuleStub();

test('UI initialization restores globals and DOM when observation fails', async () => {
  const browser = new Window({ url: 'https://www.youtube.com/tv#/' });
  const restoreGlobals = installDOMGlobals(browser);
  globalThis.__YTAF_VERSION__ = 'audit-test';
  browser.__spatialNavigation__ = { keyMode: 'ARROW' };
  const hostCommand = () => 'host command';
  browser.ytaf_showOptionsPanel = hostCommand;
  globalThis.MutationObserver = class {
    observe() {
      throw new Error('observer unavailable');
    }

    disconnect() {}
  };

  try {
    const ui = await import('../src/ui.js');
    assert.throws(() => ui.installUI(), /observer unavailable/);
    assert.equal(browser.document.querySelector('.ytaf-ui-container'), null);
    assert.equal(browser.ytaf_showOptionsPanel, hostCommand);
    assert.equal(browser.__spatialNavigation__.keyMode, 'ARROW');
  } finally {
    delete globalThis.__YTAF_VERSION__;
    restoreGlobals();
    await browser.close();
  }
});
