import sha256 from 'tiny-sha256';

import { SPONSORBLOCK_ORIGIN } from './runtime-origins.js';
import { fetchSponsorBlockJSON } from './sponsorblock-client.js';
import { parseSponsorBlockResponse } from './sponsorblock-schema.js';

const SPONSORBLOCK_API = `${SPONSORBLOCK_ORIGIN}/api`;
const CACHE_TTL_MS = 5 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 16;

/** @typedef {{ category: string, segment: [number, number] }} SponsorSegment */
/** @type {Map<string, { expiresAt: number, segments: SponsorSegment[] }>} */
const segmentCache = new Map();

/** @param {SponsorSegment[]} segments */
function cloneSegments(segments) {
  return segments.map(({ category, segment }) => ({
    category,
    segment: /** @type {[number, number]} */ ([segment[0], segment[1]])
  }));
}

/** @param {string} videoID @param {string[]} categories */
function createCacheKey(videoID, categories) {
  return `${videoID}\u0000${categories.join(',')}`;
}

/** @param {string} key */
function readSegmentCache(key) {
  const cached = segmentCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    segmentCache.delete(key);
    return null;
  }
  segmentCache.delete(key);
  segmentCache.set(key, cached);
  return cloneSegments(cached.segments);
}

/** @param {string} key @param {SponsorSegment[]} segments */
function writeSegmentCache(key, segments) {
  segmentCache.delete(key);
  segmentCache.set(key, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    segments: cloneSegments(segments)
  });
  while (segmentCache.size > MAX_CACHE_ENTRIES) {
    const oldest = segmentCache.keys().next().value;
    if (typeof oldest !== 'string') break;
    segmentCache.delete(oldest);
  }
}

/**
 * Fetch and correlate the hashed-prefix response before it reaches playback.
 * @param {string} videoID
 * @param {string[]} categories
 * @param {AbortSignal | undefined} signal
 */
export async function loadSponsorSegments(videoID, categories, signal) {
  const cacheKey = createCacheKey(videoID, categories);
  const cached = readSegmentCache(cacheKey);
  if (cached) return cached;

  const videoHash = sha256(videoID).substring(0, 4);
  const url = `${SPONSORBLOCK_API}/skipSegments/${videoHash}?categories=${encodeURIComponent(
    JSON.stringify(categories)
  )}`;
  const response = await fetchSponsorBlockJSON(
    url,
    fetch,
    signal ? { signal } : {}
  );
  const segments = parseSponsorBlockResponse(response, videoID);
  writeSegmentCache(cacheKey, segments);
  return cloneSegments(segments);
}

export function clearSponsorBlockSegmentCache() {
  segmentCache.clear();
}
