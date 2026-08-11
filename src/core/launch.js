const YOUTUBE_ORIGIN = 'https://www.youtube.com';
const CONTENT_INTENT_REGEX = /^(search|play|browse)Content$/i;
const MAX_RAW_PARAMS_LENGTH = 16 * 1024;
const MAX_CONTENT_TARGET_LENGTH = 4 * 1024;
const MAX_QUERY_PARAMETERS = 64;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} rawParams */
export function parseLaunchParams(rawParams) {
  if (typeof rawParams === 'string') {
    if (rawParams.length > MAX_RAW_PARAMS_LENGTH) return {};
    try {
      const parsed = JSON.parse(rawParams);
      return isRecord(parsed) && Object.keys(parsed).length <= 32 ? parsed : {};
    } catch (error) {
      console.warn(
        '[launch] Ignoring malformed launch parameters:',
        error instanceof Error ? error.message : String(error)
      );
      return {};
    }
  }

  return isRecord(rawParams) && Object.keys(rawParams).length <= 32
    ? rawParams
    : {};
}

function createDefaultURL() {
  const url = new URL(`${YOUTUBE_ORIGIN}/tv#/`);
  url.searchParams.append('env_forceFullAnimation', '1');
  url.searchParams.append('env_enableWebSpeech', '1');
  url.searchParams.append('env_enableVoice', '1');
  return url;
}

/** @param {unknown} value */
function parseTrustedYouTubeURL(value) {
  if (typeof value !== 'string' || value.length > MAX_CONTENT_TARGET_LENGTH) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.origin !== YOUTUBE_ORIGIN || !/^\/tv\/?$/.test(url.pathname)) {
      return null;
    }
    for (const [key, value] of createDefaultURL().searchParams) {
      if (!url.searchParams.has(key)) url.searchParams.set(key, value);
    }
    return url;
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
    if (key.length > 128 || value.length > 2_048) continue;
    url.searchParams.append(key, value);
  }
}

/** @param {URL} url @param {Record<string, unknown>} contentTarget */
function appendVoiceTarget(url, contentTarget) {
  const { intent, intentParam } = contentTarget;
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
  const contentTarget = params.contentTarget ?? params.target;

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
