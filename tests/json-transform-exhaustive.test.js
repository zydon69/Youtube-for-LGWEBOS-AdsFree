import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasRemovableAds,
  hasRemovableEndscreen,
  hasRemovableShorts,
  removeEndscreenFromResponse,
  removeShortsFromResponse
} from '../src/core/json-transforms.js';

test('ad applicability detects supported shapes without broad false positives', () => {
  assert.equal(hasRemovableAds({ contents: { unrelated: true } }), false);
  assert.equal(hasRemovableAds({ adPlacements: [] }), true);
  assert.equal(
    hasRemovableAds({
      contents: {
        sectionListRenderer: { contents: [{ adSlotRenderer: {} }] }
      }
    }),
    true
  );
  assert.equal(
    hasRemovableAds({
      entries: [
        {
          command: {
            reelWatchEndpoint: { adClientParams: { isAd: true } }
          }
        }
      ]
    }),
    true
  );
});

test('optional feature applicability traverses deeply and terminates on cycles', () => {
  const shorts = {
    gridRenderer: {
      items: [{ tileRenderer: { onSelectCommand: { reelWatchEndpoint: {} } } }]
    }
  };
  let deep = shorts;
  for (let index = 0; index < 150; index++) deep = { child: deep };
  deep.self = deep;

  assert.equal(hasRemovableShorts(deep), true);
  assert.equal(hasRemovableEndscreen(deep), false);
  assert.equal(
    hasRemovableEndscreen({ nested: { endscreen: { endscreenRenderer: {} } } }),
    true
  );
});

test('JSON transforms inspect matching nodes after large sibling collections', () => {
  const payload = {
    target: {
      gridRenderer: {
        items: [
          { tileRenderer: { onSelectCommand: { reelWatchEndpoint: {} } } }
        ]
      }
    },
    filler: Array.from({ length: 50_100 }, () => ({}))
  };

  removeShortsFromResponse(payload);
  assert.deepEqual(payload.target.gridRenderer.items, []);
});

test('JSON transforms inspect deeply nested payloads without recursion', () => {
  const payload = { endscreen: { endscreenRenderer: {} } };
  let root = payload;
  for (let index = 0; index < 150; index++) root = { child: root };

  removeEndscreenFromResponse(root);
  assert.equal('endscreen' in payload, false);
});

test('JSON transforms terminate on cyclic direct-call inputs', () => {
  const payload = { endscreen: { endscreenRenderer: {} } };
  payload.self = payload;

  assert.doesNotThrow(() => removeEndscreenFromResponse(payload));
  assert.equal('endscreen' in payload, false);
});
