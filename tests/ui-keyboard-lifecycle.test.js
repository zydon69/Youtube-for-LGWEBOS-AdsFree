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

test('settings survive panel removal, old DOM APIs, keyboard cycles and pointer activation', async () => {
  const browser = new Window({ url: 'https://www.youtube.com/tv#/' });
  const restoreGlobals = installDOMGlobals(browser);
  globalThis.__YTAF_VERSION__ = 'audit-test';
  const append = browser.Element.prototype.append;
  browser.Element.prototype.append = undefined;
  let ui;
  try {
    ui = await import('../src/ui.js');
    ui.installUI();
    browser.ytaf_showOptionsPanel(true);
    const panel = browser.document.querySelector('.ytaf-ui-container');
    const inputs = [...panel.querySelectorAll('input')];
    const key = (code, shiftKey = false) => {
      const event = new browser.KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        shiftKey
      });
      Object.defineProperty(event, 'keyCode', { value: code });
      browser.document.activeElement.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true);
    };
    inputs[0].parentElement.click();
    inputs[0].focus();
    key(40);
    assert.equal(browser.document.activeElement, inputs[1]);
    const checked = inputs[1].checked;
    key(13);
    assert.equal(inputs[1].checked, !checked);
    inputs[0].focus();
    key(9, true);
    assert.equal(browser.document.activeElement, inputs.at(-1));
    key(9);
    assert.equal(browser.document.activeElement, inputs[0]);
    panel.remove();
    await new Promise((resolve) => setTimeout(resolve, 90));
    assert.equal(panel.parentElement, browser.document.body);
    assert.equal(panel.contains(browser.document.activeElement), true);
    key(461);
    assert.equal(panel.style.display, 'none');
    panel.remove();
    browser.ytaf_showOptionsPanel(true);
    assert.equal(panel.parentElement, browser.document.body);
    ui.dispose();
    ui.installUI();
    assert.equal(
      browser.document.querySelectorAll('.ytaf-ui-container').length,
      1
    );
  } finally {
    ui?.dispose();
    browser.Element.prototype.append = append;
    delete globalThis.__YTAF_VERSION__;
    restoreGlobals();
    await browser.close();
  }
});
