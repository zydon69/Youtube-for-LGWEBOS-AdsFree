import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

import {
  installDOMGlobals,
  registerCSSModuleStub,
  waitForTimers
} from './helpers/dom-runtime.js';

registerCSSModuleStub();

test('video-quality wrapper installs, reacts to playback and disposes cleanly', async () => {
  const browser = new Window({ url: 'https://www.youtube.com/tv#/' });
  const restoreGlobals = installDOMGlobals(browser);
  globalThis.__YTAF_VERSION__ = 'audit-test';
  const player = browser.document.createElement('div');
  player.className = 'html5-video-player';
  let stateListener = null;
  let selectedQuality = 'auto';
  const qualityRanges = [];
  const state = { isPlaying: false, isPaused: true };
  const nativeAdd = player.addEventListener.bind(player);
  const nativeRemove = player.removeEventListener.bind(player);
  Object.assign(player, {
    addEventListener(name, listener, options) {
      if (name === 'onStateChange') stateListener = listener;
      else nativeAdd(name, listener, options);
    },
    removeEventListener(name, listener, options) {
      if (name === 'onStateChange' && stateListener === listener) {
        stateListener = null;
      } else {
        nativeRemove(name, listener, options);
      }
    },
    getPlaybackQualityLabel: () => selectedQuality,
    getAvailableQualityData: () => [
      { isPlayable: true, qualityLabel: '1080p' }
    ],
    setPlaybackQualityRange(minimum, maximum) {
      qualityRanges.push([minimum, maximum]);
      selectedQuality = minimum === 'highres' ? '1080p' : 'auto';
    },
    getVideoData: () => ({ video_id: 'video-a' }),
    getPlayerStateObject: () => state,
    isInline: () => false,
    getVideoStats: () => ({ el: 'leanback' })
  });
  browser.document.body.appendChild(player);

  let config;
  let videoQuality;
  let playerAPI;
  let ui;
  try {
    [config, videoQuality, playerAPI, ui] = await Promise.all([
      import('../src/config.js'),
      import('../src/video-quality.ts'),
      import('../src/player_api/manager.ts'),
      import('../src/ui.js')
    ]);
    await videoQuality.installVideoQuality();
    assert.equal(typeof stateListener, 'function');

    config.configWrite('forceHighResVideo', true);
    state.isPlaying = true;
    state.isPaused = false;
    stateListener();
    await waitForTimers(120);
    assert.deepEqual(qualityRanges[0], ['highres', 'highres']);

    config.configWrite('forceHighResVideo', false);
    assert.deepEqual(qualityRanges.at(-1), ['auto', 'auto']);
    videoQuality.dispose();
    videoQuality.dispose();
  } finally {
    videoQuality?.dispose();
    playerAPI?.destroyPlayerManager();
    ui?.dispose();
    delete globalThis.__YTAF_VERSION__;
    restoreGlobals();
    await browser.close();
  }
});
