import {
  CustomEventTarget,
  TypedCustomEvent,
  type EventMapOf
} from '../custom-event-target';
import { getPlayer } from './helpers';
import type { PlayerStateObject, VideoID, YTPlayer } from './yt-api';

function diffPlayerState(
  prev: PlayerStateObject | null,
  next: PlayerStateObject
) {
  if (!prev) return next;

  const changes: Partial<PlayerStateObject> = {};

  for (const k in next) {
    const key = k as keyof PlayerStateObject;
    if (next[key] !== prev[key]) {
      changes[key] = next[key];
    }
  }

  return changes;
}

interface EventMap {
  newVideo: CustomEvent<VideoID>;
  playbackStart: CustomEvent<undefined>;
}

export enum PlayerMode {
  PREVIEW,
  SHORTS,
  NORMAL
}

class PlayerManager
  extends CustomEventTarget<EventMap>
  implements PlayerManager
{
  #player;
  #lastVideoID: VideoID | null = null;
  #lastPlayerState: PlayerStateObject | null = null;

  #handleNewVideo(videoID: VideoID) {
    console.debug('[PlayerManager] new video', videoID);
    this.dispatchEvent(new TypedCustomEvent('newVideo', { detail: videoID }));
  }

  #handlePlayerStateChange = () => {
    const current = this.#player.getPlayerStateObject();
    const diff = diffPlayerState(this.#lastPlayerState, current);
    this.#lastPlayerState = current;

    const currentVideoID = this.currentVideoID;
    if (!currentVideoID) {
      this.#lastVideoID = null;
    } else if (this.#lastVideoID !== currentVideoID) {
      this.#handleNewVideo(currentVideoID);
      this.#lastVideoID = currentVideoID;
    }

    if (Object.keys(diff).length > 0) {
      console.debug('[PlayerManager] player state changed', { diff });
    }

    if (diff.isPlaying === true) {
      this.dispatchEvent(new TypedCustomEvent('playbackStart'));
    }
  };

  constructor(player: YTPlayer) {
    super();
    this.#player = player;

    player.addEventListener('onStateChange', this.#handlePlayerStateChange);
  }

  get currentVideoID(): VideoID | null {
    return this.#player.getVideoData().video_id || null;
  }

  get playerMode() {
    if (this.#player.isInline()) return PlayerMode.PREVIEW;

    if (this.#player.getVideoStats().el === 'shortspage') {
      return PlayerMode.SHORTS;
    }

    return PlayerMode.NORMAL;
  }

  get player(): YTPlayer {
    return this.#player;
  }
}

let instance: PlayerManager | null = null;
let instancePromise: Promise<PlayerManager> | null = null;

export async function getPlayerManager(): Promise<PlayerManager> {
  if (instance) return instance;
  if (!instancePromise) {
    instancePromise = getPlayer()
      .then((player) => {
        instance ??= new PlayerManager(player);
        return instance;
      })
      .finally(() => {
        instancePromise = null;
      });
  }

  return instancePromise;
}

export type { PlayerManager };
