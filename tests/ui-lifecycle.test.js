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

test('UI owns modal and screen-hidden state only for its active lifecycle', async () => {
  const browser = new Window({ url: 'https://www.youtube.com/tv#/' });
  const restoreGlobals = installDOMGlobals(browser);
  globalThis.__YTAF_VERSION__ = 'audit-test';
  browser.__spatialNavigation__ = { keyMode: 'ARROW' };
  const previousPanelCommand = () => 'host command';
  browser.ytaf_showOptionsPanel = previousPanelCommand;

  const hostContent = browser.document.createElement('main');
  hostContent.setAttribute('aria-hidden', 'false');
  const focusOrigin = browser.document.createElement('button');
  focusOrigin.textContent = 'host focus';
  hostContent.appendChild(focusOrigin);
  const unrelatedAudioOverlay = browser.document.createElement('div');
  unrelatedAudioOverlay.className = 'ytLrAudioPlayerOverlayAudioMode';
  unrelatedAudioOverlay.style.filter = 'saturate(2)';
  hostContent.appendChild(unrelatedAudioOverlay);

  const player = browser.document.createElement('div');
  player.className = 'html5-video-player';
  const video = browser.document.createElement('video');
  video.style.visibility = 'visible';
  const controls = browser.document.createElement('div');
  controls.setAttribute('idomkey', 'controls');
  const audioOverlay = browser.document.createElement('div');
  audioOverlay.className = 'ytLrAudioPlayerOverlayAudioMode';
  audioOverlay.style.filter = 'contrast(2)';
  player.append(video, controls, audioOverlay);
  browser.document.body.classList.add('app-quality-root');
  browser.document.body.append(hostContent, player);
  focusOrigin.focus();

  let ui;
  try {
    ui = await import('../src/ui.js');
    ui.installUI();
    const { configWrite } = await import('../src/config.js');
    assert.equal(
      browser.document.body.classList.contains('app-quality-root'),
      false
    );
    assert.equal(browser.__spatialNavigation__.keyMode, 'NONE');
    const panel = browser.document.querySelector('.ytaf-ui-container');
    assert.ok(panel instanceof browser.HTMLElement);
    assert.equal(panel.getAttribute('role'), 'dialog');
    assert.equal(typeof browser.ytaf_showOptionsPanel, 'function');

    configWrite('hideLogo', true);
    assert.match(browser.document.head.textContent, /visibility: hidden/);
    configWrite('hideLogo', false);
    assert.doesNotMatch(
      browser.document.head.textContent,
      /visibility: hidden/
    );

    const openEvent = dispatchLegacyKey(browser, 'keydown', 404);
    assert.equal(openEvent.defaultPrevented, true);
    assert.equal(panel.style.display, 'block');
    assert.equal(panel.getAttribute('aria-hidden'), 'false');
    assert.equal(hostContent.getAttribute('aria-hidden'), 'true');
    assert.equal(panel.contains(browser.document.activeElement), true);

    const lateHostSibling = browser.document.createElement('aside');
    lateHostSibling.setAttribute('aria-hidden', 'menu');
    browser.document.body.appendChild(lateHostSibling);
    await waitForTimers(10);
    assert.equal(lateHostSibling.getAttribute('aria-hidden'), 'true');

    const closeEvent = new browser.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true
    });
    Object.defineProperty(closeEvent, 'keyCode', { value: 27 });
    browser.document.activeElement?.dispatchEvent(closeEvent);
    assert.equal(panel.style.display, 'none');
    assert.equal(hostContent.getAttribute('aria-hidden'), 'false');
    assert.equal(lateHostSibling.getAttribute('aria-hidden'), 'menu');
    assert.equal(browser.document.activeElement, focusOrigin);

    dispatchLegacyKey(browser, 'keydown', 406);
    await waitForTimers(10);
    assert.equal(video.style.visibility, 'hidden');
    assert.equal(
      audioOverlay.style.getPropertyValue('filter'),
      'brightness(0)'
    );
    assert.equal(unrelatedAudioOverlay.style.filter, 'saturate(2)');
    assert.equal(
      controls.firstElementChild?.textContent,
      'Screen hidden - Press [BLUE] to toggle'
    );

    const previewPlayer = browser.document.createElement('div');
    previewPlayer.className = 'html5-video-player';
    const previewVideo = browser.document.createElement('video');
    const previewControls = browser.document.createElement('div');
    previewControls.setAttribute('idomkey', 'controls');
    previewPlayer.append(previewVideo, previewControls);
    browser.document.body.appendChild(previewPlayer);
    await waitForTimers(90);
    assert.equal(video.style.visibility, 'hidden');
    assert.notEqual(previewVideo.style.visibility, 'hidden');
    assert.equal(
      controls.querySelector('.ytaf-ui-watchControl-overlayMessage')
        ?.textContent,
      'Screen hidden - Press [BLUE] to toggle'
    );
    previewPlayer.remove();

    Object.defineProperty(video, 'paused', {
      configurable: true,
      value: true
    });
    video.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 320,
      bottom: 180,
      width: 320,
      height: 180
    });
    const replacementPlayer = browser.document.createElement('div');
    replacementPlayer.className = 'html5-video-player';
    const replacementVideo = browser.document.createElement('video');
    Object.defineProperty(replacementVideo, 'paused', {
      configurable: true,
      value: false
    });
    replacementVideo.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 640,
      bottom: 360,
      width: 640,
      height: 360
    });
    const replacementControls = browser.document.createElement('div');
    replacementControls.setAttribute('idomkey', 'controls');
    replacementPlayer.append(replacementVideo, replacementControls);
    browser.document.body.appendChild(replacementPlayer);
    await waitForTimers(90);
    assert.equal(video.style.visibility, 'visible');
    assert.equal(replacementVideo.style.visibility, 'hidden');
    assert.equal(
      replacementControls.firstElementChild?.textContent,
      'Screen hidden - Press [BLUE] to toggle'
    );

    dispatchLegacyKey(browser, 'keydown', 406);
    await waitForTimers(10);
    assert.equal(video.style.visibility, 'visible');
    assert.equal(audioOverlay.style.filter, 'contrast(2)');
    assert.equal(
      controls.querySelector('.ytaf-ui-watchControl-overlayMessage'),
      null
    );

    for (let index = 0; index < 7; index++) {
      ui.showNotification(`notice ${index}`, 5, 'blue');
    }
    assert.equal(
      browser.document.querySelector('.ytaf-notification-container')?.children
        .length,
      5
    );

    browser.ytaf_showOptionsPanel(true);
    assert.equal(hostContent.getAttribute('aria-hidden'), 'true');
    ui.dispose();
    ui.dispose();
    assert.equal(browser.document.querySelector('.ytaf-ui-container'), null);
    assert.equal(
      browser.document.querySelector('.ytaf-notification-container'),
      null
    );
    assert.equal(hostContent.getAttribute('aria-hidden'), 'false');
    assert.equal(browser.ytaf_showOptionsPanel, previousPanelCommand);
    assert.equal(browser.__spatialNavigation__.keyMode, 'ARROW');
    assert.equal(
      browser.document.body.classList.contains('app-quality-root'),
      true
    );
    assert.equal(browser.document.activeElement, focusOrigin);

    dispatchLegacyKey(browser, 'keydown', 404);
    assert.equal(browser.document.querySelector('.ytaf-ui-container'), null);
  } finally {
    ui?.dispose();
    delete globalThis.__YTAF_VERSION__;
    restoreGlobals();
    await browser.close();
  }
});
