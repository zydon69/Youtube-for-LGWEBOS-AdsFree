import {
  configAddChangeListener,
  configRead,
  configRemoveChangeListener
} from './config';
import { VideoQualityController } from './core/video-quality-controller';
import { getPlayerManager, PlayerMode } from './player_api';
import type { EventMapOf, PlayerManager } from './player_api';
import { showNotification } from './ui';

type PlayerEventMap = EventMapOf<PlayerManager>;

let controller: VideoQualityController | null = null;
let manager: PlayerManager | null = null;
let installationGeneration = 0;

const handleNewVideo = (_event: PlayerEventMap['newVideo']) => {
  controller?.handleNewVideo();
};
const handlePlaybackStart = (_event: PlayerEventMap['playbackStart']) => {
  controller?.handlePlaybackStart();
};
const handleConfigChange = (event: CustomEvent<{ newValue: boolean }>) => {
  controller?.setEnabled(event.detail.newValue);
};

export async function installVideoQuality() {
  if (controller) return;
  const generation = ++installationGeneration;
  const nextManager = await getPlayerManager();
  if (generation !== installationGeneration) return;

  const nextController = new VideoQualityController(
    {
      getPlayer: () => nextManager.player,
      getVideoID: () => nextManager.currentVideoID,
      isPreview: () => nextManager.playerMode === PlayerMode.PREVIEW
    },
    { notify: showNotification }
  );

  try {
    nextManager.addEventListener('newVideo', handleNewVideo);
    nextManager.addEventListener('playbackStart', handlePlaybackStart);
    configAddChangeListener('forceHighResVideo', handleConfigChange);
    manager = nextManager;
    controller = nextController;
    nextController.setEnabled(configRead('forceHighResVideo'));
  } catch (error) {
    nextManager.removeEventListener('newVideo', handleNewVideo);
    nextManager.removeEventListener('playbackStart', handlePlaybackStart);
    configRemoveChangeListener('forceHighResVideo', handleConfigChange);
    nextController.dispose();
    manager = null;
    controller = null;
    throw error;
  }
}

export function dispose() {
  installationGeneration++;
  manager?.removeEventListener('newVideo', handleNewVideo);
  manager?.removeEventListener('playbackStart', handlePlaybackStart);
  configRemoveChangeListener('forceHighResVideo', handleConfigChange);
  controller?.dispose();
  controller = null;
  manager = null;
}

void installVideoQuality().catch((error) => {
  console.warn('[video-quality] Feature unavailable', error);
});
