export const SPONSORBLOCK_CATEGORIES = Object.freeze([
  'sponsor',
  'intro',
  'outro',
  'interaction',
  'selfpromo',
  'music_offtopic',
  'preview'
]);

const categorySet = new Set(SPONSORBLOCK_CATEGORIES);

export function parseSponsorBlockResponse(value, videoID) {
  if (!Array.isArray(value)) return [];

  const match = value.find(
    (entry) =>
      entry !== null &&
      typeof entry === 'object' &&
      entry.videoID === videoID &&
      Array.isArray(entry.segments)
  );
  if (!match) return [];

  return match.segments
    .filter((entry) => {
      if (entry === null || typeof entry !== 'object') return false;
      if (!categorySet.has(entry.category) || !Array.isArray(entry.segment)) {
        return false;
      }

      const [start, end] = entry.segment;
      return (
        typeof start === 'number' &&
        Number.isFinite(start) &&
        typeof end === 'number' &&
        Number.isFinite(end) &&
        start >= 0 &&
        end > start
      );
    })
    .map(({ category, segment: [start, end] }) => ({
      category,
      segment: [start, end]
    }));
}
