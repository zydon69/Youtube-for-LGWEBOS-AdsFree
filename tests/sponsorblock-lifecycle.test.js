import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

import {
  installDOMGlobals,
  registerCSSModuleStub
} from './helpers/dom-runtime.js';

registerCSSModuleStub();

function makeCapablePlayer(browser, videoID) {
  const player = browser.document.createElement('div');
  player.className = 'html5-video-player';
  Object.assign(player, {
    getPlaybackQualityLabel: () => '1080p',
    getAvailableQualityData: () => [],
    setPlaybackQualityRange: () => undefined,
    getVideoData: () => ({ video_id: videoID }),
    getPlayerStateObject: () => ({ isPlaying: false }),
    isInline: () => false,
    getVideoStats: () => ({ el: 'leanback' })
  });
  const video = browser.document.createElement('video');
  video.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 640,
    bottom: 360,
    width: 640,
    height: 360
  });
  player.appendChild(video);
  browser.document.body.appendChild(player);
  return player;
}

test('SponsorBlock correlates the player video before network access', async () => {
  const browser = new Window({
    url: 'https://www.youtube.com/tv#/watch?v=route-video'
  });
  const restoreGlobals = installDOMGlobals(browser);
  const previousFetch = globalThis.fetch;
  const previousVersion = globalThis.__YTAF_VERSION__;
  globalThis.__YTAF_VERSION__ = 'audit-test';
  browser.localStorage.setItem(
    'ytaf-configuration-v2',
    JSON.stringify({
      enableSponsorBlock: true,
      enableSponsorBlockSponsor: false,
      enableSponsorBlockIntro: false,
      enableSponsorBlockOutro: false,
      enableSponsorBlockInteraction: false,
      enableSponsorBlockSelfPromo: false,
      enableSponsorBlockMusicOfftopic: false,
      enableSponsorBlockPreview: false
    })
  );
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return new Response('[]', {
      headers: { 'content-type': 'application/json' }
    });
  };
  makeCapablePlayer(browser, 'player-video');

  let sponsorBlock;
  let playerManager;
  let ui;
  let domMutations;
  try {
    sponsorBlock = await import('../src/sponsorblock.js');
    sponsorBlock.installSponsorBlock();
    [playerManager, ui, domMutations] = await Promise.all([
      import('../src/player_api/manager.ts'),
      import('../src/ui.js'),
      import('../src/core/dom-mutations.js')
    ]);
    const handler = new sponsorBlock.SponsorBlockHandler('route-video', [
      'sponsor'
    ]);
    await handler.init();

    assert.equal(requests, 0);
    handler.destroy();
  } finally {
    sponsorBlock?.dispose();
    playerManager?.destroyPlayerManager();
    ui?.dispose();
    domMutations?.disconnectDOMMutationCoordinator();
    globalThis.fetch = previousFetch;
    if (previousVersion === undefined) delete globalThis.__YTAF_VERSION__;
    else globalThis.__YTAF_VERSION__ = previousVersion;
    restoreGlobals();
    await browser.close();
  }
});
