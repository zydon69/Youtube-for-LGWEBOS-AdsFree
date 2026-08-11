import { SPONSORBLOCK_CATEGORIES } from './sponsorblock-categories.js';

export { SPONSORBLOCK_CATEGORIES } from './sponsorblock-categories.js';

export const MAX_SPONSORBLOCK_RESPONSE_BYTES = 512 * 1024;
export const MAX_SPONSORBLOCK_CANDIDATES = 64;
export const MAX_SPONSORBLOCK_SEGMENTS = 256;
const MAX_REASONABLE_VIDEO_SECONDS = 24 * 60 * 60;

const categorySet = new Set(SPONSORBLOCK_CATEGORIES);

/** @typedef {{ category: string, segment: [number, number] }} SponsorSegment */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} duration */
function normalizeDuration(duration) {
  return typeof duration === 'number' &&
    Number.isFinite(duration) &&
    duration > 0
    ? Math.min(duration, MAX_REASONABLE_VIDEO_SECONDS)
    : MAX_REASONABLE_VIDEO_SECONDS;
}

/**
 * @param {unknown} value
 * @param {string} videoID
 * @param {unknown} [duration]
 * @returns {SponsorSegment[]}
 */
export function parseSponsorBlockResponse(value, videoID, duration) {
  if (!Array.isArray(value) || value.length > MAX_SPONSORBLOCK_CANDIDATES) {
    return [];
  }

  const match = value.find(
    (entry) =>
      isRecord(entry) &&
      entry.videoID === videoID &&
      Array.isArray(entry.segments) &&
      entry.segments.length <= MAX_SPONSORBLOCK_SEGMENTS
  );
  if (!match) return [];

  const maxEnd = normalizeDuration(duration);
  /** @type {SponsorSegment[]} */
  const normalized = [];
  for (const entry of match.segments) {
    if (!isRecord(entry) || typeof entry.category !== 'string') continue;
    if (!categorySet.has(entry.category) || !Array.isArray(entry.segment))
      continue;
    const [start, end] = entry.segment;
    if (
      typeof start !== 'number' ||
      !Number.isFinite(start) ||
      typeof end !== 'number' ||
      !Number.isFinite(end) ||
      start < 0 ||
      start >= maxEnd ||
      end <= start
    ) {
      continue;
    }
    normalized.push({
      category: entry.category,
      segment: [start, Math.min(end, maxEnd)]
    });
  }
  normalized.sort((left, right) =>
    left.segment[0] === right.segment[0]
      ? left.segment[1] - right.segment[1]
      : left.segment[0] - right.segment[0]
  );

  /** @type {SponsorSegment[]} */
  const deduplicated = [];
  const seen = new Set();
  for (const segment of normalized) {
    const key = `${segment.category}:${segment.segment[0]}:${segment.segment[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduplicated.push(segment);
  }

  return deduplicated;
}
