const YOUTUBE_ORIGIN = 'https://www.youtube.com';
const WEBOS_CAST_WAKE_PATH = /^\/wake_cast_core\/?$/;

/** Blocks the official YouTube TV endpoint that wakes the webOS cast service. */
export function isWebOSCastWakeRequest(url: URL) {
  return (
    url.origin === YOUTUBE_ORIGIN && WEBOS_CAST_WAKE_PATH.test(url.pathname)
  );
}
