import {
  configAddChangeListener,
  configRead,
  configRemoveChangeListener
} from './config';
import {
  isQualityPlayer,
  VideoQualityController
} from './core/video-quality-controller';
import { getPlayerManager, PlayerMode } from './player_api';
import type { EventMapOf, PlayerManager } from './player_api';
import { showNotification } from './core/notifications';

type PlayerEventMap = EventMapOf<PlayerManager>;

let controller: VideoQualityController | null = null;
let manager: PlayerManager | null = null;
let installationGeneration = 0;
let installed = false;

const handleNewVideo = (_event: PlayerEventMap['newVideo']) => {
  controller?.handleNewVideo();
};
const handlePlaybackStart = (_event: PlayerEventMap['playbackStart']) => {
  controller?.handlePlaybackStart();
};
const handleConfigChange = (event: CustomEvent<{ newValue: boolean }>) => {
  if (!event.detail.newValue) {
    deactivateVideoQuality();
    return;
  }
  void activateVideoQuality().catch((error) => {
    console.warn('[video-quality] Feature unavailable', error);
  });
};

async function activateVideoQuality() {
  if (controller) return;
  const generation = ++installationGeneration;
  const nextManager = await getPlayerManager();
  if (
    generation !== installationGeneration ||
    !installed ||
    !configRead('forceHighResVideo')
  ) {
    return;
  }

  const nextController = new VideoQualityController(
    {
      getPlayer: () => {
        const player = nextManager.player;
        if (!isQualityPlayer(player)) {
          throw new Error('YouTube quality capabilities are unavailable');
        }
        return player;
      },
      getVideoID: () => nextManager.currentVideoID,
      isPreview: () => nextManager.playerMode === PlayerMode.PREVIEW
    },
    { notify: showNotification }
  );

  try {
    nextManager.addEventListener('newVideo', handleNewVideo);
    nextManager.addEventListener('playbackStart', handlePlaybackStart);
    manager = nextManager;
    controller = nextController;
    nextController.setEnabled(true);
  } catch (error) {
    nextManager.removeEventListener('newVideo', handleNewVideo);
    nextManager.removeEventListener('playbackStart', handlePlaybackStart);
    nextController.dispose();
    manager = null;
    controller = null;
    throw error;
  }
}

function deactivateVideoQuality() {
  installationGeneration++;
  manager?.removeEventListener('newVideo', handleNewVideo);
  manager?.removeEventListener('playbackStart', handlePlaybackStart);
  controller?.dispose();
  controller = null;
  manager = null;
}

export async function installVideoQuality() {
  if (installed) return;
  configAddChangeListener('forceHighResVideo', handleConfigChange);
  installed = true;
  try {
    if (configRead('forceHighResVideo')) await activateVideoQuality();
  } catch (error) {
    dispose();
    throw error;
  }
}

export function dispose() {
  if (!installed) return;
  installed = false;
  configRemoveChangeListener('forceHighResVideo', handleConfigChange);
  deactivateVideoQuality();
}
