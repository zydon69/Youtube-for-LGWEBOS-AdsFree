import assert from 'node:assert/strict';
import test from 'node:test';

import { Window } from 'happy-dom';

test('player lookup detects a placeholder whose capabilities hydrate in place', async () => {
  const window = new Window({ url: 'https://www.youtube.com/tv#/' });
  const previousGlobals = {
    document: globalThis.document,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    MutationObserver: globalThis.MutationObserver,
    window: globalThis.window
  };
  Object.assign(globalThis, {
    document: window.document,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    MutationObserver: window.MutationObserver,
    window
  });

  try {
    const { getCapablePlayer } = await import('../src/player_api/helpers.ts');
    const player = window.document.createElement('div');
    player.className = 'html5-video-player';
    window.document.body.appendChild(player);
    const pending = getCapablePlayer({
      timeoutMs: 200
    });
    window.setTimeout(() => {
      Object.assign(player, {
        getVideoData: () => ({ video_id: 'video' }),
        getPlayerStateObject: () => ({ isPlaying: false })
      });
      player.appendChild(window.document.createElement('span'));
    }, 10);

    assert.equal(await pending, player);
    assert.equal(await getCapablePlayer(), player);
  } finally {
    Object.assign(globalThis, previousGlobals);
    await window.close();
  }
});
