/** Keep the active watch-page video exactly aligned with the viewport. */
import { resolveActiveVideo } from './core/active-media-resolver.ts';
import { InlineStyleOwner } from './core/inline-style-owner.js';
import { subscribeDOMMutations } from './core/dom-mutations.js';

function isWatchPage() {
  return document.body?.classList.contains('WEB_PAGE_TYPE_WATCH') === true;
}

function isPlayerHidden(video: HTMLVideoElement) {
  if (video.hidden || video.style.top.startsWith('-')) return true;
  try {
    const computed = video.ownerDocument.defaultView?.getComputedStyle(video);
    if (
      computed?.display === 'none' ||
      computed?.visibility === 'hidden' ||
      computed?.visibility === 'collapse'
    ) {
      return true;
    }
    let ancestor = video.parentElement;
    while (ancestor) {
      const ancestorStyle =
        video.ownerDocument.defaultView?.getComputedStyle(ancestor);
      if (ancestorStyle?.display === 'none') return true;
      ancestor = ancestor.parentElement;
    }
    const rect = video.getBoundingClientRect();
    const viewport = video.ownerDocument.defaultView;
    if (
      viewport &&
      rect.width > 0 &&
      rect.height > 0 &&
      (rect.right <= 0 ||
        rect.bottom <= 0 ||
        rect.left >= viewport.innerWidth ||
        rect.top >= viewport.innerHeight)
    ) {
      return true;
    }
  } catch {
    // Geometry and inline style remain usable on legacy/cross-realm elements.
  }
  return false;
}

function findActiveWatchVideo() {
  if (!isWatchPage()) return null;
  const active = resolveActiveVideo();
  if (active) return active;
  // Keep observing an already-hidden player so a later style/hidden attribute
  // change can make it eligible without requiring unrelated DOM mutations.
  const videos = document.querySelectorAll('video');
  let fallback: HTMLVideoElement | null = null;
  for (let index = 0; index < videos.length; index++) {
    const video = videos[index];
    if (String(video?.tagName).toUpperCase() !== 'VIDEO') continue;
    const candidate = video as HTMLVideoElement;
    if (!fallback) fallback = candidate;
    if (candidate.paused === false && candidate.ended !== true)
      return candidate;
  }
  return fallback;
}

function applyPlayerDimensions(
  video: HTMLVideoElement,
  styles: InlineStyleOwner
) {
  const width = `${window.innerWidth}px`;
  const height = `${window.innerHeight}px`;
  if (video.style.width !== width) styles.set('width', width);
  if (video.style.height !== height) styles.set('height', height);
  if (video.style.left !== '0px') styles.set('left', '0px');
  if (video.style.top !== '0px') styles.set('top', '0px');
}

let observedVideo: HTMLVideoElement | null = null;
let ownedStyles: InlineStyleOwner | null = null;
let observedBody: HTMLElement | null = null;
let bodyClassObserver: MutationObserver | null = null;
let unsubscribeDOM: (() => void) | null = null;
let synchronizationToken: number | null = null;
let initialized = false;

const playerObserver = new MutationObserver(queueSynchronization);

function observePlayerVisibility(video: HTMLVideoElement) {
  playerObserver.disconnect();
  let current: HTMLElement | null = video;
  while (current) {
    playerObserver.observe(current, {
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden']
    });
    current = current.parentElement;
  }
}

function bindBodyObserver() {
  const body = document.body;
  if (body === observedBody) return;
  bodyClassObserver?.disconnect();
  bodyClassObserver = null;
  observedBody = body;
  if (!body) return;
  bodyClassObserver = new MutationObserver(queueSynchronization);
  bodyClassObserver.observe(body, {
    attributes: true,
    attributeFilter: ['class'],
    subtree: false
  });
}

function synchronizePlayerObserver() {
  synchronizationToken = null;
  bindBodyObserver();
  const video = findActiveWatchVideo();
  if (video === observedVideo) {
    if (!video) return;
    observePlayerVisibility(video);
    if (isPlayerHidden(video)) {
      ownedStyles?.restore();
      ownedStyles = null;
    } else {
      ownedStyles ??= new InlineStyleOwner(video, [
        'width',
        'height',
        'left',
        'top'
      ]);
      applyPlayerDimensions(video, ownedStyles);
    }
    return;
  }

  playerObserver.disconnect();
  ownedStyles?.restore();
  ownedStyles = null;
  observedVideo = video;
  if (!video) return;
  observePlayerVisibility(video);
  if (isPlayerHidden(video)) return;
  ownedStyles = new InlineStyleOwner(video, ['width', 'height', 'left', 'top']);
  applyPlayerDimensions(video, ownedStyles);
}

function queueSynchronization() {
  if (!initialized || synchronizationToken !== null) return;
  synchronizationToken = window.setTimeout(synchronizePlayerObserver, 50);
}

export function dispose() {
  document.removeEventListener('DOMContentLoaded', initializeScreensaverFix);
  if (!initialized) return;
  initialized = false;
  if (synchronizationToken !== null) {
    window.clearTimeout(synchronizationToken);
    synchronizationToken = null;
  }
  playerObserver.disconnect();
  bodyClassObserver?.disconnect();
  bodyClassObserver = null;
  observedBody = null;
  unsubscribeDOM?.();
  unsubscribeDOM = null;
  window.removeEventListener('resize', queueSynchronization);
  ownedStyles?.restore();
  ownedStyles = null;
  observedVideo = null;
}

function initializeScreensaverFix() {
  if (initialized || !document.body) return;
  initialized = true;
  try {
    bindBodyObserver();
    unsubscribeDOM = subscribeDOMMutations(queueSynchronization, {
      delayMs: 25
    });
    window.addEventListener('resize', queueSynchronization);
    synchronizePlayerObserver();
  } catch (error) {
    dispose();
    throw error;
  }
}

export function installScreensaverFix() {
  if (initialized) return;
  if (document.body) initializeScreensaverFix();
  else {
    document.addEventListener('DOMContentLoaded', initializeScreensaverFix, {
      once: true
    });
  }
}
