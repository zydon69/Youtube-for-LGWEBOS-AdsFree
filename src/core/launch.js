const YOUTUBE_ORIGIN = 'https://www.youtube.com';
const CONTENT_INTENT_REGEX = /^(search|play|browse)Content$/i;
const MAX_RAW_PARAMS_LENGTH = 16 * 1024;
const MAX_CONTENT_TARGET_LENGTH = 4 * 1024;
const MAX_QUERY_PARAMETERS = 64;
const MAX_QUERY_KEY_LENGTH = 128;
const MAX_QUERY_VALUE_LENGTH = 2_048;
const DEFAULT_QUERY_PARAMETERS = Object.freeze({
  env_forceFullAnimation: '1',
  env_enableWebSpeech: '1',
  env_enableVoice: '1'
});
const RESERVED_PARTIAL_PARAMETERS = new Set([
  ...Object.keys(DEFAULT_QUERY_PARAMETERS),
  'inApp',
  'launch',
  'va',
  'vq',
  'vs'
]);

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {Record<string, unknown>} value */
function copyKnownLaunchParams(value) {
  try {
    const keys = Object.keys(value);
    if (keys.length > 32) return {};
    /** @type {Record<string, unknown>} */
    const result = {};
    for (const key of ['contentTarget', 'target']) {
      if (Object.hasOwn(value, key)) result[key] = value[key];
    }
    return result;
  } catch (error) {
    console.warn(
      '[launch] Ignoring unreadable launch parameters:',
      error instanceof Error ? error.message : String(error)
    );
    return {};
  }
}

/** @param {unknown} rawParams */
export function parseLaunchParams(rawParams) {
  if (typeof rawParams === 'string') {
    if (rawParams.length > MAX_RAW_PARAMS_LENGTH) return {};
    try {
      const parsed = JSON.parse(rawParams);
      return isRecord(parsed) ? copyKnownLaunchParams(parsed) : {};
    } catch (error) {
      console.warn(
        '[launch] Ignoring malformed launch parameters:',
        error instanceof Error ? error.message : String(error)
      );
      return {};
    }
  }

  return isRecord(rawParams) ? copyKnownLaunchParams(rawParams) : {};
}

function createDefaultURL() {
  const url = new URL(`${YOUTUBE_ORIGIN}/tv#/`);
  for (const [key, value] of Object.entries(DEFAULT_QUERY_PARAMETERS)) {
    url.searchParams.set(key, value);
  }
  return url;
}

/** @param {URLSearchParams} target @param {URLSearchParams} source */
function copyBoundedQueryParameters(target, source) {
  let count = 0;
  for (const [key, value] of source) {
    if (++count > MAX_QUERY_PARAMETERS) return false;
    if (
      key.length === 0 ||
      key.length > MAX_QUERY_KEY_LENGTH ||
      value.length > MAX_QUERY_VALUE_LENGTH
    ) {
      continue;
    }
    target.append(key, value);
  }
  return true;
}

/** @param {unknown} value */
function parseTrustedYouTubeURL(value) {
  if (typeof value !== 'string' || value.length > MAX_CONTENT_TARGET_LENGTH) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      url.origin !== YOUTUBE_ORIGIN ||
      url.username !== '' ||
      url.password !== '' ||
      !/^\/tv\/?$/.test(url.pathname) ||
      (url.hash !== '' && !url.hash.startsWith('#/'))
    ) {
      return null;
    }

    const normalized = new URL(`${YOUTUBE_ORIGIN}/tv${url.hash || '#/'}`);
    if (
      !copyBoundedQueryParameters(normalized.searchParams, url.searchParams)
    ) {
      return null;
    }
    for (const [key, defaultValue] of Object.entries(
      DEFAULT_QUERY_PARAMETERS
    )) {
      normalized.searchParams.delete(key);
      normalized.searchParams.set(key, defaultValue);
    }
    return normalized;
  } catch {
    return null;
  }
}

/** @param {URL} url @param {string} contentTarget */
function appendPartialTarget(url, contentTarget) {
  if (contentTarget.length > MAX_CONTENT_TARGET_LENGTH) return;
  let normalizedTarget = contentTarget;
  if (normalizedTarget.startsWith('v=v=')) {
    normalizedTarget = normalizedTarget.substring(2);
  }

  let count = 0;
  for (const [key, value] of new URLSearchParams(normalizedTarget)) {
    if (++count > MAX_QUERY_PARAMETERS) break;
    if (
      key.length === 0 ||
      key.length > MAX_QUERY_KEY_LENGTH ||
      value.length > MAX_QUERY_VALUE_LENGTH ||
      RESERVED_PARTIAL_PARAMETERS.has(key)
    ) {
      continue;
    }
    url.searchParams.append(key, value);
  }
}

/** @param {URL} url @param {Record<string, unknown>} contentTarget */
function appendVoiceTarget(url, contentTarget) {
  let intent;
  let intentParam;
  try {
    intent = contentTarget.intent;
    intentParam = contentTarget.intentParam;
  } catch {
    return;
  }
  if (typeof intent !== 'string' || typeof intentParam !== 'string') return;

  if (intentParam.length > 2_048) return;
  const voiceContentIntent = intent
    .match(CONTENT_INTENT_REGEX)?.[1]
    ?.toLowerCase();
  const search = url.searchParams;

  if (!voiceContentIntent) return;
  search.set('inApp', 'true');
  search.set('vs', '9');
  if (voiceContentIntent) search.set('va', voiceContentIntent);

  search.append('launch', 'voice');
  if (voiceContentIntent === 'search') search.append('launch', 'search');
  search.set('vq', intentParam);
}

/** @param {unknown} rawParams */
export function buildLaunchURL(rawParams) {
  const params = parseLaunchParams(rawParams);
  const url = createDefaultURL();
  const explicitContentTarget = Object.hasOwn(params, 'contentTarget')
    ? params.contentTarget
    : undefined;
  const fallbackTarget = Object.hasOwn(params, 'target')
    ? params.target
    : undefined;
  const contentTarget = explicitContentTarget ?? fallbackTarget;

  if (typeof contentTarget === 'string') {
    const directURL = parseTrustedYouTubeURL(contentTarget);
    if (directURL) return directURL;

    if (!contentTarget.includes('://')) appendPartialTarget(url, contentTarget);
  } else if (isRecord(contentTarget)) {
    appendVoiceTarget(url, contentTarget);
  }

  return url;
}

export { YOUTUBE_ORIGIN };
