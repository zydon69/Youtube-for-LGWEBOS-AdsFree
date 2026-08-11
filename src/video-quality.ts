import { configAddChangeListener, configRead } from './config';
import { getPlayerManager, PlayerMode } from './player_api';
import type { EventMapOf, PlayerManager } from './player_api';
import { showNotification } from './ui';

type PlayerEventMap = EventMapOf<PlayerManager>;

let intervalToken: number | undefined;
let timeoutToken: number | undefined;

function shouldForce() {
  return configRead('forceHighResVideo');
}

function clearQualityPolling() {
  if (intervalToken !== undefined) window.clearInterval(intervalToken);
  if (timeoutToken !== undefined) window.clearTimeout(timeoutToken);
  intervalToken = undefined;
  timeoutToken = undefined;
}

function getMaxQualityLabel(player: PlayerManager['player']) {
  return player
    .getAvailableQualityData()
    .filter(({ isPlayable, qualityLabel }) => isPlayable && qualityLabel)
    .sort(
      (left, right) =>
        qualityRank(right.qualityLabel) - qualityRank(left.qualityLabel)
    )[0]?.qualityLabel;
}

function qualityRank(label: string) {
  const verticalPixels = Number(label.match(/\d+/)?.[0] ?? 0);
  return verticalPixels + (/\b4k\b/i.test(label) ? 2160 : 0);
}

function restoreAutomaticQuality(manager: PlayerManager) {
  try {
    manager.player.setPlaybackQualityRange('auto', 'auto');
  } catch (error) {
    console.warn('[video-quality] Unable to restore automatic quality', error);
  }
}

function notifyPlaybackQuality(manager: PlayerManager) {
  if (!shouldForce()) return;

  const selected = manager.player.getPlaybackQualityLabel();
  const max = getMaxQualityLabel(manager.player);
  showNotification(
    `${selected || 'Unknown'} selected (Max ${max || 'Unknown'})`,
    3000
  );
}

function setPlaybackQuality(this: PlayerManager) {
  if (!shouldForce()) {
    this.removeEventListener('playbackStart', setPlaybackQuality);
    clearQualityPolling();
    return;
  }
  if (this.playerMode === PlayerMode.PREVIEW) return;

  this.removeEventListener('playbackStart', setPlaybackQuality);
  clearQualityPolling();

  const previousQuality = this.player.getPlaybackQualityLabel();
  this.player.setPlaybackQualityRange('highres', 'highres');

  if (previousQuality && previousQuality === getMaxQualityLabel(this.player)) {
    notifyPlaybackQuality(this);
    return;
  }

  intervalToken = window.setInterval(() => {
    if (!shouldForce()) {
      clearQualityPolling();
      return;
    }

    try {
      const currentQuality = this.player.getPlaybackQualityLabel();
      if (currentQuality && currentQuality !== previousQuality) {
        clearQualityPolling();
        notifyPlaybackQuality(this);
      }
    } catch (error) {
      clearQualityPolling();
      console.warn('[video-quality] Quality polling failed', error);
    }
  }, 100);

  timeoutToken = window.setTimeout(() => {
    clearQualityPolling();
    notifyPlaybackQuality(this);
  }, 3000);
}

function armQualitySelection(manager: PlayerManager) {
  manager.removeEventListener('playbackStart', setPlaybackQuality);
  if (shouldForce())
    manager.addEventListener('playbackStart', setPlaybackQuality);
}

function handleNewVideo(
  this: PlayerManager,
  _event: PlayerEventMap['newVideo']
) {
  clearQualityPolling();
  armQualitySelection(this);
}

async function installVideoQuality() {
  const manager = await getPlayerManager();
  manager.addEventListener('newVideo', handleNewVideo);
  armQualitySelection(manager);
  if (shouldForce() && manager.currentVideoID) {
    setPlaybackQuality.call(manager);
  }

  configAddChangeListener('forceHighResVideo', (event) => {
    clearQualityPolling();
    armQualitySelection(manager);
    if (event.detail.newValue && manager.currentVideoID) {
      setPlaybackQuality.call(manager);
    } else if (!event.detail.newValue) {
      restoreAutomaticQuality(manager);
    }
  });
}

void installVideoQuality().catch((error) => {
  console.warn('[video-quality] Feature unavailable', error);
});
