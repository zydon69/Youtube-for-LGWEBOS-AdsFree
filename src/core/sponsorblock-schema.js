import { SPONSORBLOCK_CATEGORIES } from './sponsorblock-categories.js';

export const MAX_SPONSORBLOCK_RESPONSE_BYTES = 512 * 1024;
export const MAX_SPONSORBLOCK_SEGMENTS = 256;
export const MAX_SPONSORBLOCK_CANDIDATES = 512;
const MAX_RAW_SEGMENTS_TO_INSPECT = MAX_SPONSORBLOCK_SEGMENTS * 8;
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
  if (!Array.isArray(value)) return [];

  let match = null;
  const candidateCount = Math.min(value.length, MAX_SPONSORBLOCK_CANDIDATES);
  for (let index = 0; index < candidateCount; index++) {
    const entry = value[index];
    if (
      isRecord(entry) &&
      entry.videoID === videoID &&
      Array.isArray(entry.segments)
    ) {
      match = entry;
      break;
    }
  }
  if (!match) return [];

  return normalizeSponsorSegments(match.segments, duration);
}

/**
 * Validate, sort, merge and duration-bound already correlated segments.
 * @param {unknown} value
 * @param {unknown} [duration]
 * @returns {SponsorSegment[]}
 */
export function normalizeSponsorSegments(value, duration) {
  if (!Array.isArray(value)) return [];

  const maxEnd = normalizeDuration(duration);
  /** @type {SponsorSegment[]} */
  const normalized = [];
  const rawCount = Math.min(value.length, MAX_RAW_SEGMENTS_TO_INSPECT);
  for (let index = 0; index < rawCount; index++) {
    if (normalized.length >= MAX_SPONSORBLOCK_SEGMENTS * 2) break;
    const entry = value[index];
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
  const compacted = [];
  /** @type {Map<string, SponsorSegment>} */
  const lastByCategory = new Map();
  const seen = new Set();
  for (const segment of normalized) {
    const key = `${segment.category}:${segment.segment[0]}:${segment.segment[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const previous = lastByCategory.get(segment.category);
    if (previous && segment.segment[0] <= previous.segment[1]) {
      previous.segment[1] = Math.max(previous.segment[1], segment.segment[1]);
      continue;
    }
    compacted.push(segment);
    lastByCategory.set(segment.category, segment);
    if (compacted.length >= MAX_SPONSORBLOCK_SEGMENTS) break;
  }

  return compacted;
}

/** @param {unknown} value */
export function isValidSponsorBlockVideoID(value) {
  return (
    typeof value === 'string' &&
    value.length >= 6 &&
    value.length <= 64 &&
    /^[\w-]+$/.test(value)
  );
}
