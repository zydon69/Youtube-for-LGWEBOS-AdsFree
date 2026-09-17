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

test('screen-hidden waits for a late player and leaves host navigation untouched', async () => {
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
    assert.equal(browser.__spatialNavigation__.keyMode, undefined);

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

test('screen-hidden never borrows another player controls while its own controls are pending', async () => {
  const browser = new Window({ url: 'https://www.youtube.com/tv#/' });
  const restoreGlobals = installDOMGlobals(browser);
  globalThis.__YTAF_VERSION__ = 'audit-test';
  let ui;
  try {
    const player = browser.document.createElement('div');
    player.className = 'html5-video-player';
    const video = browser.document.createElement('video');
    player.appendChild(video);
    const unrelated = browser.document.createElement('div');
    unrelated.setAttribute('idomkey', 'controls');
    browser.document.body.append(player, unrelated);
    ui = await import('../src/ui.js');
    ui.installUI();
    dispatchLegacyKey(browser, 'keydown', 406);
    await waitForTimers(10);
    assert.notEqual(video.style.visibility, 'hidden');
    assert.equal(unrelated.children.length, 0);
    const controls = browser.document.createElement('div');
    controls.setAttribute('idomkey', 'controls');
    player.appendChild(controls);
    await waitForTimers(90);
    assert.equal(video.style.visibility, 'hidden');
    assert.match(controls.textContent, /Screen hidden/);
    assert.equal(unrelated.children.length, 0);
  } finally {
    ui?.dispose();
    delete globalThis.__YTAF_VERSION__;
    restoreGlobals();
    await browser.close();
  }
});
