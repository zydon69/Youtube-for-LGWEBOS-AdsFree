import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

import {
  installDOMGlobals,
  registerCSSModuleStub
} from './helpers/dom-runtime.js';

registerCSSModuleStub();

test('JSON feature wrappers honor live opt-ins and unregister completely', async () => {
  const browser = new Window({ url: 'https://www.youtube.com/tv#/' });
  const restoreGlobals = installDOMGlobals(browser);
  const nativeParse = JSON.parse;
  const nativeStringify = JSON.stringify;
  let contentFilters;
  let jsonHooks;

  try {
    const config = await import('../src/config.js');
    [contentFilters, jsonHooks] = await Promise.all([
      import('../src/content-filters.ts'),
      import('../src/hooks/json.ts')
    ]);
    contentFilters.installContentFilters();

    const responseText = nativeStringify({
      adSlots: [{ adSlotRenderer: {} }],
      browse: {
        gridRenderer: {
          items: [
            { tileRenderer: { onSelectCommand: { reelWatchEndpoint: {} } } }
          ]
        }
      },
      overlay: { endscreen: { endscreenRenderer: {} } }
    });
    let parsed = JSON.parse(responseText);
    assert.equal('adSlots' in parsed, false);
    assert.equal(parsed.browse.gridRenderer.items.length, 1);
    assert.equal('endscreen' in parsed.overlay, true);

    const request = JSON.stringify({
      playbackContext: { contentPlaybackContext: { marker: true } }
    });
    assert.equal(
      nativeParse(request).playbackContext.contentPlaybackContext
        .isInlinePlaybackNoAd,
      true
    );

    config.configWrite('enableAdBlock', false);
    config.configWrite('removeShorts', true);
    config.configWrite('removeEndscreen', true);
    parsed = JSON.parse(responseText);
    assert.equal(parsed.adSlots.length, 1);
    assert.equal(parsed.browse.gridRenderer.items.length, 0);
    assert.equal('endscreen' in parsed.overlay, false);
    assert.equal(
      nativeParse(
        JSON.stringify({
          playbackContext: { contentPlaybackContext: { marker: true } }
        })
      ).playbackContext.contentPlaybackContext.isInlinePlaybackNoAd,
      undefined
    );

    contentFilters.dispose();
    contentFilters.dispose();
    config.configWrite('enableAdBlock', true);
    parsed = JSON.parse(responseText);
    assert.equal(parsed.adSlots.length, 1);
    assert.equal(parsed.browse.gridRenderer.items.length, 1);
    assert.equal('endscreen' in parsed.overlay, true);
  } finally {
    contentFilters?.dispose();
    jsonHooks?.restoreJSONHooks();
    assert.equal(JSON.parse, nativeParse);
    assert.equal(JSON.stringify, nativeStringify);
    restoreGlobals();
    await browser.close();
  }
});

test('cast blocking wrapper is exact, reversible and keeps native requests', async () => {
  const browser = new Window({ url: 'https://www.youtube.com/tv#/' });
  const restoreGlobals = installDOMGlobals(browser);
  const nativeCalls = [];
  const nativeFetch = async (resource) => {
    nativeCalls.push(String(resource));
    return new Response('ok');
  };
  browser.fetch = nativeFetch;
  let castBlock;
  let fetchHooks;

  try {
    castBlock = await import('../src/block-webos-cast.ts');
    fetchHooks = await import('../src/hooks/fetch.ts');
    castBlock.installBlockWebOSCast();
    await assert.rejects(
      browser.fetch('https://www.youtube.com/wake_cast_core'),
      /Failed to fetch/
    );
    assert.deepEqual(nativeCalls, []);

    await browser.fetch('https://www.youtube.com/wake_cast_core_extra');
    assert.deepEqual(nativeCalls, [
      'https://www.youtube.com/wake_cast_core_extra'
    ]);

    castBlock.dispose();
    castBlock.dispose();
    await browser.fetch('https://www.youtube.com/wake_cast_core');
    assert.equal(nativeCalls.length, 2);
  } finally {
    castBlock?.dispose();
    fetchHooks?.disposeFetchRegistry();
    assert.equal(browser.fetch, nativeFetch);
    restoreGlobals();
    await browser.close();
  }
});
