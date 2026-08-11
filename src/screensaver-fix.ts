/** Keep the active watch-page video exactly aligned with the viewport. */

function isPlayerHidden(video: HTMLVideoElement) {
  return video.style.display === 'none' || video.style.top.startsWith('-');
}

function isWatchPage() {
  return document.body.classList.contains('WEB_PAGE_TYPE_WATCH');
}

function applyPlayerDimensions(video: HTMLVideoElement) {
  if (!isWatchPage() || isPlayerHidden(video)) return;
  const width = `${window.innerWidth}px`;
  const height = `${window.innerHeight}px`;
  if (video.style.width !== width) video.style.width = width;
  if (video.style.height !== height) video.style.height = height;
  if (video.style.left !== '0px') video.style.left = '0px';
  if (video.style.top !== '0px') video.style.top = '0px';
}

let observedVideo: HTMLVideoElement | null = null;
let synchronizationToken: number | null = null;

const playerObserver = new MutationObserver(() => {
  if (observedVideo) applyPlayerDimensions(observedVideo);
});

function synchronizePlayerObserver() {
  synchronizationToken = null;
  const candidate = isWatchPage() ? document.querySelector('video') : null;
  const video = candidate instanceof HTMLVideoElement ? candidate : null;
  if (video === observedVideo) {
    if (video) applyPlayerDimensions(video);
    return;
  }

  playerObserver.disconnect();
  observedVideo = video;
  if (!video) return;
  applyPlayerDimensions(video);
  playerObserver.observe(video, {
    attributes: true,
    attributeFilter: ['style']
  });
}

function queueSynchronization() {
  if (synchronizationToken !== null) return;
  synchronizationToken = window.setTimeout(synchronizePlayerObserver, 50);
}

function initializeScreensaverFix() {
  const bodyClassObserver = new MutationObserver(queueSynchronization);
  bodyClassObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
    subtree: false
  });
  const documentObserver = new MutationObserver(queueSynchronization);
  documentObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
  window.addEventListener('resize', queueSynchronization);
  synchronizePlayerObserver();
}

if (document.body) initializeScreensaverFix();
else {
  document.addEventListener('DOMContentLoaded', initializeScreensaverFix, {
    once: true
  });
}
