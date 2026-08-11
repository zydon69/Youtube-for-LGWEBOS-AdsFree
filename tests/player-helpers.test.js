import assert from 'node:assert/strict';
import test from 'node:test';

import { Window } from 'happy-dom';

test('player lookup observes child additions without document-wide attributes', async () => {
  const window = new Window({ url: 'https://www.youtube.com/tv#/' });
  const nativeObserver = window.MutationObserver;
  let observationOptions;

  class TrackingMutationObserver extends nativeObserver {
    observe(target, options) {
      observationOptions = options;
      return super.observe(target, options);
    }
  }

  const previousGlobals = {
    document: globalThis.document,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    MutationObserver: globalThis.MutationObserver
  };
  Object.assign(globalThis, {
    document: window.document,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    MutationObserver: TrackingMutationObserver
  });

  try {
    const { getCapablePlayer } = await import('../src/player_api/helpers.ts');
    const pending = getCapablePlayer({
      timeoutMs: 200
    });
    const player = window.document.createElement('div');
    player.className = 'html5-video-player';
    Object.assign(player, {
      getPlaybackQualityLabel: () => '1080p',
      getAvailableQualityData: () => [],
      setPlaybackQualityRange: () => undefined,
      getVideoData: () => ({ video_id: 'video' }),
      getPlayerStateObject: () => ({ isPlaying: false }),
      isInline: () => false,
      getVideoStats: () => ({ el: 'leanback' })
    });
    window.document.body.appendChild(player);

    assert.equal(await pending, player);
    assert.equal(observationOptions?.childList, true);
    assert.equal(observationOptions?.subtree, true);
    assert.notEqual(observationOptions?.attributes, true);
    assert.equal(await getCapablePlayer(), player);
  } finally {
    Object.assign(globalThis, previousGlobals);
    await window.close();
  }
});
