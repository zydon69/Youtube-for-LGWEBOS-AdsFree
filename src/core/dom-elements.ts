interface MatchableElement {
  matches?: (selectors: string) => boolean;
  webkitMatchesSelector?: (selectors: string) => boolean;
  msMatchesSelector?: (selectors: string) => boolean;
}

/** Cross-realm selector matching for the Safari versions used by older TVs. */
export function elementMatches(value: unknown, selectors: string) {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as MatchableElement;
  const matcher =
    candidate.matches ??
    candidate.webkitMatchesSelector ??
    candidate.msMatchesSelector;
  if (typeof matcher !== 'function') return false;
  try {
    return Reflect.apply(matcher, value, [selectors]) === true;
  } catch {
    return false;
  }
}
