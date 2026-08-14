import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

import {
  dispatchLegacyKey,
  installDOMGlobals,
  registerCSSModuleStub,
  waitForTimers
} from './helpers/dom-runtime.js';

registerCSSModuleStub();

test('screen-hidden waits for a late player and restores an undefined key mode', async () => {
  const browser = new Window({ url: 'https://www.youtube.com/tv#/' });
  const restoreGlobals = installDOMGlobals(browser);
  globalThis.__YTAF_VERSION__ = 'audit-test';
  browser.__spatialNavigation__ = {};
  Object.defineProperty(browser.__spatialNavigation__, 'keyMode', {
    configurable: true,
    enumerable: false,
    value: undefined,
    writable: true
  });
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    browser.__spatialNavigation__,
    'keyMode'
  );

  let ui;
  try {
    ui = await import('../src/ui.js');
    ui.installUI();
    assert.equal(browser.__spatialNavigation__.keyMode, 'NONE');

    dispatchLegacyKey(browser, 'keydown', 406);
    await waitForTimers(10);

    const player = browser.document.createElement('div');
    player.className = 'html5-video-player';
    const video = browser.document.createElement('video');
    video.style.visibility = 'visible';
    const controls = browser.document.createElement('div');
    controls.setAttribute('idomkey', 'controls');
    player.append(video, controls);
    browser.document.body.appendChild(player);
    await waitForTimers(90);

    assert.equal(video.style.visibility, 'hidden');
    assert.match(controls.textContent, /Screen hidden/);

    ui.dispose();
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(browser.__spatialNavigation__, 'keyMode'),
      originalDescriptor
    );
    assert.equal(video.style.visibility, 'visible');
  } finally {
    ui?.dispose();
    delete globalThis.__YTAF_VERSION__;
    restoreGlobals();
    await browser.close();
  }
});
