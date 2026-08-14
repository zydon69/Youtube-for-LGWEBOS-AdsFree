import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearSponsorBlockSegmentCache,
  loadSponsorSegments
} from '../src/core/sponsorblock-repository.js';

function sponsorResponse(videoID) {
  const body = JSON.stringify([
    {
      videoID,
      segments: [{ category: 'sponsor', segment: [10, 20] }]
    }
  ]);
  return new Response(body, {
    headers: {
      'content-length': String(body.length),
      'content-type': 'application/json'
    }
  });
}

test('SponsorBlock repository correlates, clones and caches bounded entries', async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const videoID = calls.length <= 2 ? 'cache-video' : `video-${calls.length}`;
    return sponsorResponse(videoID);
  };
  clearSponsorBlockSegmentCache();
  try {
    const first = await loadSponsorSegments('cache-video', ['sponsor']);
    first[0].segment[0] = 99;
    const cached = await loadSponsorSegments('cache-video', ['sponsor']);
    assert.equal(calls.length, 1);
    assert.equal(cached[0].segment[0], 10);
    assert.match(calls[0], /^https:\/\/sponsor\.ajay\.app\/api\//);

    clearSponsorBlockSegmentCache();
    await loadSponsorSegments('cache-video', ['sponsor']);
    assert.equal(calls.length, 2);
  } finally {
    clearSponsorBlockSegmentCache();
    globalThis.fetch = previousFetch;
  }
});

test('SponsorBlock repository discards uncorrelated responses', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => sponsorResponse('different-video');
  clearSponsorBlockSegmentCache();
  try {
    assert.deepEqual(
      await loadSponsorSegments('requested-video', ['sponsor']),
      []
    );
  } finally {
    clearSponsorBlockSegmentCache();
    globalThis.fetch = previousFetch;
  }
});
