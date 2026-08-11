const SEEK_EPSILON_SECONDS = 0.05;

/**
 * @param {{ category: string, segment: [number, number] }[]} segments
 * @param {Set<string>} allowedCategories
 * @param {number} currentTime
 */
export function findNextSponsorSegment(
  segments,
  allowedCategories,
  currentTime
) {
  if (!Number.isFinite(currentTime)) return null;
  return (
    segments.find(
      (candidate) =>
        allowedCategories.has(candidate.category) &&
        candidate.segment[1] > currentTime + SEEK_EPSILON_SECONDS
    ) ?? null
  );
}

/**
 * Revalidate a scheduled segment at execution time.
 * @param {[number, number]} segment
 * @param {number} currentTime
 * @param {number} duration
 */
export function decideSponsorSkip(segment, currentTime, duration) {
  const [start, end] = segment;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    !Number.isFinite(currentTime) ||
    end <= start
  ) {
    return null;
  }
  if (currentTime >= end - SEEK_EPSILON_SECONDS) return null;
  if (currentTime < start - SEEK_EPSILON_SECONDS) return { reschedule: true };
  const target =
    Number.isFinite(duration) && duration > 0 ? Math.min(end, duration) : end;
  return target > currentTime + SEEK_EPSILON_SECONDS ? { target } : null;
}

/**
 * Convert media time into wall-clock delay while respecting playback speed.
 * @param {number} start
 * @param {number} currentTime
 * @param {number} playbackRate
 */
export function computeSponsorDelayMs(start, currentTime, playbackRate) {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(currentTime) ||
    !Number.isFinite(playbackRate) ||
    playbackRate <= 0
  ) {
    return null;
  }
  return Math.max(0, ((start - currentTime) / playbackRate) * 1_000);
}
