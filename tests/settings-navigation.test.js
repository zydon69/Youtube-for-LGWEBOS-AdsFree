import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { installDOMGlobals } from './helpers/dom-runtime.js';
import {
  getFocusableSettings,
  moveSettingsFocus
} from '../src/core/settings-navigation.ts';

test('dialog arrows follow geometry, retain boundaries and ignore pointer history and the global viewport', () => {
  const browser = new Window();
  const restore = installDOMGlobals(browser);
  const document = browser.document;
  try {
    const panel = document.createElement('div');
    document.body.appendChild(panel);
    const controls = Array.from({ length: 4 }, (_, index) => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      panel.appendChild(input);
      const top = 2000 + Math.floor(index / 2) * 40;
      const left = (index % 2) * 100;
      input.getBoundingClientRect = () => ({
        top,
        left,
        bottom: top + 20,
        right: left + 20,
        width: 20,
        height: 20
      });
      return input;
    });
    panel.getBoundingClientRect = () => ({ top: 2000, bottom: 2030 });
    controls[0].focus();
    panel.dispatchEvent(
      new browser.MouseEvent('mousedown', { clientX: 0, clientY: 0 })
    );
    for (const [direction, expected] of [
      ['right', 1],
      ['down', 3],
      ['down', 3],
      ['left', 2],
      ['up', 0],
      ['up', 0]
    ]) {
      moveSettingsFocus(panel, direction);
      assert.equal(document.activeElement, controls[expected]);
    }
    assert.ok(panel.scrollTop > 0);
    controls[1].disabled = true;
    controls[2].hidden = true;
    controls[3].tabIndex = -1;
    assert.deepEqual(getFocusableSettings(panel), [controls[0]]);
    document.body.focus();
    moveSettingsFocus(panel, 'down');
    assert.equal(document.activeElement, controls[0]);
    assert.equal(browser.navigate, undefined);
    assert.equal(browser.Element.prototype.spatialNavigationSearch, undefined);
  } finally {
    restore();
    browser.close();
  }
});

test('dialog navigation supports prefixed matching and excludes disabled controls', () => {
  const browser = new Window();
  const restore = installDOMGlobals(browser);
  const document = browser.document;
  const nativeMatches = browser.Element.prototype.matches;
  try {
    const panel = document.createElement('div');
    const first = document.createElement('input');
    const fieldset = document.createElement('fieldset');
    const unavailable = document.createElement('input');
    const last = document.createElement('input');
    unavailable.disabled = true;
    fieldset.appendChild(unavailable);
    panel.appendChild(first);
    panel.appendChild(fieldset);
    panel.appendChild(last);
    document.body.appendChild(panel);
    browser.Element.prototype.webkitMatchesSelector = nativeMatches;
    browser.Element.prototype.matches = undefined;
    assert.deepEqual(getFocusableSettings(panel), [first, last]);
    first.focus();
    moveSettingsFocus(panel, 'down');
    assert.equal(document.activeElement, last);
    moveSettingsFocus(panel, 'up');
    assert.equal(document.activeElement, first);
    unavailable.disabled = false;
    assert.deepEqual(getFocusableSettings(panel), [first, unavailable, last]);
  } finally {
    browser.Element.prototype.matches = nativeMatches;
    delete browser.Element.prototype.webkitMatchesSelector;
    restore();
    browser.close();
  }
});
