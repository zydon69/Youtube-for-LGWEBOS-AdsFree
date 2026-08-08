import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLaunchURL, parseLaunchParams } from '../src/core/launch.js';
import { normalizeConfig } from '../src/core/config-schema.js';
import {
  removeAdsFromResponse,
  removeEndscreenFromResponse,
  removeShortsFromResponse,
  withInlinePlaybackNoAd
} from '../src/core/json-transforms.js';
import { parseSponsorBlockResponse } from '../src/core/sponsorblock-schema.js';

test('launch URLs never leave the exact YouTube origin', () => {
  for (const target of [
    'https://www.youtube.com.evil.example/phish',
    'https://www.youtube.com@evil.example/phish',
    'http://www.youtube.com/tv'
  ]) {
    assert.equal(
      buildLaunchURL({ contentTarget: target }).origin,
      'https://www.youtube.com'
    );
  }

  assert.equal(
    buildLaunchURL({ contentTarget: 'https://www.youtube.com/tv#/watch?v=abc' })
      .href,
    'https://www.youtube.com/tv#/watch?v=abc'
  );
});

test('invalid launch parameters degrade to an empty object', () => {
  assert.deepEqual(parseLaunchParams('{broken'), {});
  assert.deepEqual(parseLaunchParams(null), {});
  assert.deepEqual(parseLaunchParams([]), {});
});

test('playback payload enrichment preserves native JSON semantics', () => {
  const callback = () => undefined;
  const payload = {
    keep: 1,
    callback,
    playbackContext: { contentPlaybackContext: { marker: true } }
  };

  const enriched = withInlinePlaybackNoAd(payload);

  assert.equal(enriched.callback, callback);
  assert.equal(
    enriched.playbackContext.contentPlaybackContext.isInlinePlaybackNoAd,
    true
  );
  assert.equal(
    payload.playbackContext.contentPlaybackContext.isInlinePlaybackNoAd,
    undefined
  );
  assert.equal(
    JSON.stringify(enriched),
    '{"keep":1,"playbackContext":{"contentPlaybackContext":{"marker":true,"isInlinePlaybackNoAd":true}}}'
  );
});

test('ad removal tolerates heterogeneous YouTube shelves', () => {
  const response = {
    contents: {
      sectionListRenderer: {
        contents: [
          { shelfRenderer: { content: { verticalListRenderer: {} } } },
          {
            shelfRenderer: {
              content: {
                horizontalListRenderer: {
                  items: [{ adSlotRenderer: {} }, { tileRenderer: {} }]
                }
              }
            }
          },
          { adSlotRenderer: {} }
        ]
      }
    }
  };

  assert.doesNotThrow(() => removeAdsFromResponse(response));
  const contents = response.contents.sectionListRenderer.contents;
  assert.equal(contents.length, 2);
  assert.equal(
    contents[1].shelfRenderer.content.horizontalListRenderer.items.length,
    1
  );
});

test('short and endscreen transformations cover every matching container', () => {
  const response = {
    first: {
      gridRenderer: {
        items: [
          { tileRenderer: { onSelectCommand: { reelWatchEndpoint: {} } } }
        ]
      }
    },
    second: {
      gridRenderer: { items: [{ tileRenderer: { videoId: 'kept' } }] }
    },
    endscreen: { endscreenRenderer: {} }
  };

  removeShortsFromResponse(response);
  removeEndscreenFromResponse(response);

  assert.deepEqual(response.first.gridRenderer.items, []);
  assert.equal(response.second.gridRenderer.items.length, 1);
  assert.equal('endscreen' in response, false);
});

test('stored configuration only accepts known boolean values', () => {
  const defaults = { enabled: true, optional: false };

  assert.deepEqual(normalizeConfig(true, defaults), defaults);
  assert.deepEqual(
    normalizeConfig(
      { enabled: false, optional: 'yes', injected: true },
      defaults
    ),
    { enabled: false, optional: false }
  );
});

test('SponsorBlock responses are validated and normalized', () => {
  const response = [
    {
      videoID: 'video',
      segments: [
        { category: 'sponsor', segment: [1, 4] },
        { category: 'sponsor', segment: [5, 3] },
        { category: 'unknown', segment: [1, 2] }
      ]
    }
  ];

  assert.deepEqual(parseSponsorBlockResponse(response, 'video'), [
    { category: 'sponsor', segment: [1, 4] }
  ]);
  assert.deepEqual(parseSponsorBlockResponse({}, 'video'), []);
});
