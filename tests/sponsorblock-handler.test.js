import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

import {
  installDOMGlobals,
  registerCSSModuleStub
} from './helpers/dom-runtime.js';

registerCSSModuleStub();

test('SponsorBlock keeps a correlated video through transient metadata gaps', async () => {
  const browser = new Window({ url: 'https://www.youtube.com/tv#/' });
  const restoreGlobals = installDOMGlobals(browser);
  globalThis.__YTAF_VERSION__ = 'audit-test';
  browser.localStorage.setItem(
    'ytaf-configuration-v2',
    JSON.stringify({ enableSponsorBlock: false })
  );

  const player = browser.document.createElement('div');
  player.className = 'html5-video-player';
  const video = browser.document.createElement('video');
  Object.defineProperties(video, {
    currentTime: { configurable: true, writable: true, value: 12 },
    duration: { configurable: true, value: 120 },
    paused: { configurable: true, value: false }
  });
  const progressBar = browser.document.createElement('div');
  progressBar.setAttribute('idomkey', 'progress-bar');
  const slider = browser.document.createElement('div');
  slider.setAttribute('idomkey', 'slider');
  progressBar.appendChild(slider);
  player.append(video, progressBar);
  browser.document.body.appendChild(player);

  let sponsorBlock;
  let ui;
  try {
    sponsorBlock = await import('../src/sponsorblock.js');
    ui = await import('../src/ui.js');
    const handler = new sponsorBlock.SponsorBlockHandler('video12345', [
      'sponsor'
    ]);
    handler.playerManager = {
      get currentVideoID() {
        return null;
      },
      player,
      removeEventListener() {}
    };
    handler.video = video;
    handler.segments = [{ category: 'sponsor', segment: [10, 20] }];

    handler.renderOverlay();
    assert.equal(slider.classList.contains('ytaf-sponsorblock-active'), true);
    assert.ok(slider.querySelector('.ytaf-sponsorblock-segment-container'));

    handler.executeScheduledSkip(handler.segments[0]);
    assert.equal(video.currentTime, 20);
    assert.equal(
      Array.from(browser.document.querySelectorAll('.message')).some(
        (message) => message.textContent === 'Skipping sponsored segment'
      ),
      true
    );

    handler.segments = [];
    handler.renderOverlay();
    assert.equal(slider.classList.contains('ytaf-sponsorblock-active'), false);
    assert.equal(
      slider.querySelector('.ytaf-sponsorblock-segment-container'),
      null
    );
    handler.destroy();
  } finally {
    sponsorBlock?.dispose();
    ui?.dispose();
    delete globalThis.__YTAF_VERSION__;
    restoreGlobals();
    await browser.close();
  }
});
