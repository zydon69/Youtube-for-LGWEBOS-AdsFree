/**
 * On webOS, when a video element doesn't perfectly fill
 * the entire screen, the screensaver can be kick in.
 */

import { requireElement } from './player_api/helpers';

function isPlayerHidden(video: HTMLVideoElement) {
  // Youtube uses display none sometimes along with a negative top to hide the HTMLVideoElement.
  return video.style.display == 'none' || video.style.top.startsWith('-');
}

function isWatchPage() {
  return document.body.classList.contains('WEB_PAGE_TYPE_WATCH');
}

const playerCtrlObs = new MutationObserver((mutations, obs) => {
  // Only watch page has a full-screen player.
  if (!isWatchPage()) {
    obs.disconnect();
    return;
  }

  const video = mutations[0]?.target;
  if (!(video instanceof HTMLVideoElement)) throw new Error();
  const style = video.style;

  // Not sure if there will be a race condition so just in case.
  if (isPlayerHidden(video)) return;

  const targetWidth = `${window.innerWidth}px`;
  const targetHeight = `${window.innerHeight}px`;
  const targetLeft = '0px';
  const targetTop = '0px';

  /**
   * Check to see if identical before assignment as some webOS versions will trigger a mutation
   * event even if the assignment effectively does nothing, leading to an infinite loop.
   */
  style.width !== targetWidth && (style.width = targetWidth);
  style.height !== targetHeight && (style.height = targetHeight);
  style.left !== targetLeft && (style.left = targetLeft);
  style.top !== targetTop && (style.top = targetTop);
});

let syncGeneration = 0;

async function synchronizePlayerObserver() {
  const generation = ++syncGeneration;
  playerCtrlObs.disconnect();
  if (!isWatchPage()) return;

  try {
    // YouTube TV re-uses the same video element for everything.
    const video = await requireElement('video', HTMLVideoElement);
    if (generation !== syncGeneration || !isWatchPage()) return;

    playerCtrlObs.observe(video, {
      attributes: true,
      attributeFilter: ['style']
    });
  } catch (error) {
    if (generation === syncGeneration) {
      console.warn('[screensaver-fix] Video did not become available', error);
    }
  }
}

const bodyAttrObs = new MutationObserver(() => {
  void synchronizePlayerObserver();
});

bodyAttrObs.observe(document.body, {
  attributes: true,
  attributeFilter: ['class']
});

void synchronizePlayerObserver();
