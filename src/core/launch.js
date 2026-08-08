const YOUTUBE_ORIGIN = 'https://www.youtube.com';
const CONTENT_INTENT_REGEX = /^.+(?=Content)/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseLaunchParams(rawParams) {
  if (typeof rawParams === 'string') {
    try {
      const parsed = JSON.parse(rawParams);
      return isRecord(parsed) ? parsed : {};
    } catch (error) {
      console.warn(
        '[launch] Ignoring malformed launch parameters:',
        error instanceof Error ? error.message : String(error)
      );
      return {};
    }
  }

  return isRecord(rawParams) ? rawParams : {};
}

function createDefaultURL() {
  const url = new URL(`${YOUTUBE_ORIGIN}/tv#/`);
  url.searchParams.append('env_forceFullAnimation', '1');
  url.searchParams.append('env_enableWebSpeech', '1');
  url.searchParams.append('env_enableVoice', '1');
  return url;
}

function parseTrustedYouTubeURL(value) {
  try {
    const url = new URL(value);
    return url.origin === YOUTUBE_ORIGIN ? url : null;
  } catch {
    return null;
  }
}

function appendPartialTarget(url, contentTarget) {
  let normalizedTarget = contentTarget;
  if (normalizedTarget.startsWith('v=v=')) {
    normalizedTarget = normalizedTarget.substring(2);
  }

  for (const [key, value] of new URLSearchParams(normalizedTarget)) {
    url.searchParams.append(key, value);
  }
}

function appendVoiceTarget(url, contentTarget) {
  const { intent, intentParam } = contentTarget;
  if (typeof intent !== 'string' || typeof intentParam !== 'string') return;

  const voiceContentIntent = intent
    .match(CONTENT_INTENT_REGEX)?.[0]
    ?.toLowerCase();
  const search = url.searchParams;

  search.set('inApp', 'true');
  search.set('vs', '9');
  if (voiceContentIntent) search.set('va', voiceContentIntent);

  search.append('launch', 'voice');
  if (voiceContentIntent === 'search') search.append('launch', 'search');
  search.set('vq', intentParam);
}

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
