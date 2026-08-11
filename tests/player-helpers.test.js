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
    const { getPlayer, requireElement } =
      await import('../src/player_api/helpers.ts');
    const pending = requireElement('.html5-video-player', window.HTMLElement, {
      timeoutMs: 200
    });
    const player = window.document.createElement('div');
    player.className = 'html5-video-player';
    window.document.body.appendChild(player);

    assert.equal(await pending, player);
    assert.equal(observationOptions?.childList, true);
    assert.equal(observationOptions?.subtree, true);
    assert.notEqual(observationOptions?.attributes, true);
    assert.equal(
      await requireElement('.html5-video-player', window.HTMLElement),
      player
    );
    assert.equal(await getPlayer(), player);
    await assert.rejects(
      requireElement('.html5-video-player', window.HTMLInputElement)
    );
  } finally {
    Object.assign(globalThis, previousGlobals);
    await window.close();
  }
});
