import { CustomEventTarget, TypedCustomEvent } from '../custom-event-target.ts';
import { resolveActiveVideo } from '../core/active-media-resolver.ts';
import { findCapablePlayer, getCapablePlayer, isYTPlayer } from './helpers.ts';
import type {
  PlayerStateKeys,
  PlayerStateObject,
  VideoID,
  YTPlayer
} from './yt-api.ts';

const PLAYER_STATE_KEYS = [
  'isBuffering',
  'isCued',
  'isDomPaused',
  'isEnded',
  'isError',
  'isOrWillBePlaying',
  'isPaused',
  'isPlaying',
  'isSeeking',
  'isUiSeeking',
  'isUnstarted'
] as const satisfies readonly PlayerStateKeys[];

type PlayerStateSnapshot = Partial<PlayerStateObject>;

function snapshotPlayerState(value: unknown): PlayerStateSnapshot {
  if (value === null || typeof value !== 'object') return {};
  const source = value as Partial<PlayerStateObject>;
  const snapshot: PlayerStateSnapshot = {};
  for (const key of PLAYER_STATE_KEYS) {
    const state = source[key];
    if (typeof state === 'boolean') snapshot[key] = state;
  }
  return snapshot;
}

function diffPlayerState(
  previous: PlayerStateSnapshot | null,
  next: PlayerStateSnapshot
) {
  if (!previous) return next;
  const changes: PlayerStateSnapshot = {};
  for (const key of PLAYER_STATE_KEYS) {
    const state = next[key];
    if (typeof state === 'boolean' && state !== previous[key]) {
      changes[key] = state;
    }
  }
  return changes;
}

interface EventMap {
  newVideo: TypedCustomEvent<VideoID, unknown, 'newVideo'>;
  playbackStart: TypedCustomEvent<undefined, unknown, 'playbackStart'>;
}

export const PlayerMode = Object.freeze({
  PREVIEW: 0,
  SHORTS: 1,
  NORMAL: 2
} as const);

export type PlayerMode = (typeof PlayerMode)[keyof typeof PlayerMode];

export class PlayerManager extends CustomEventTarget<EventMap> {
  #player: YTPlayer;
  #lastVideoID: VideoID | null = null;
  #lastPlayerState: PlayerStateSnapshot | null = null;
  #synchronizationToken: number | null = null;
  #destroyed = false;

  #handleNewVideo(videoID: VideoID) {
    this.dispatchEvent(new TypedCustomEvent('newVideo', { detail: videoID }));
  }

  #handlePlayerStateChange = () => {
    if (this.#destroyed) return;
    try {
      const current = snapshotPlayerState(this.#player.getPlayerStateObject());
      const diff = diffPlayerState(this.#lastPlayerState, current);
      this.#lastPlayerState = current;

      const currentVideoID = this.currentVideoID;
      let startedNewVideo = false;
      if (!currentVideoID) {
        this.#lastVideoID = null;
      } else if (this.#lastVideoID !== currentVideoID) {
        this.#handleNewVideo(currentVideoID);
        this.#lastVideoID = currentVideoID;
        startedNewVideo = true;
      }

      if (
        diff.isPlaying === true ||
        (startedNewVideo && current.isPlaying === true)
      ) {
        this.dispatchEvent(
          new TypedCustomEvent<undefined, 'playbackStart'>('playbackStart')
        );
      }
    } catch (error) {
      console.warn('[player] Unable to read player state', error);
    }
  };

  constructor(player: YTPlayer) {
    super();
    if (!isYTPlayer(player)) {
      throw new TypeError('YouTube player capabilities are incomplete');
    }
    this.#player = player;
    try {
      player.addEventListener('onStateChange', this.#handlePlayerStateChange);
      this.#synchronizationToken = window.setInterval(
        () => this.#synchronizePlayer(),
        2_000
      );
    } catch (error) {
      try {
        player.removeEventListener(
          'onStateChange',
          this.#handlePlayerStateChange
        );
      } catch (rollbackError) {
        console.warn(
          '[player] Unable to roll back player listener',
          rollbackError
        );
      }
      throw error;
    }
  }

  #synchronizePlayer() {
    if (this.#destroyed) return;
    const candidate = findCapablePlayer();
    if (!candidate || candidate === this.#player) return;

    try {
      candidate.addEventListener(
        'onStateChange',
        this.#handlePlayerStateChange
      );
    } catch (error) {
      console.warn('[player] Unable to observe replacement player', error);
      return;
    }

    try {
      this.#player.removeEventListener(
        'onStateChange',
        this.#handlePlayerStateChange
      );
    } catch (error) {
      console.warn('[player] Unable to detach previous player', error);
      try {
        candidate.removeEventListener(
          'onStateChange',
          this.#handlePlayerStateChange
        );
      } catch (rollbackError) {
        console.warn(
          '[player] Unable to roll back replacement listener',
          rollbackError
        );
      }
      return;
    }

    this.#player = candidate;
    this.#lastPlayerState = null;
    this.#lastVideoID = null;
    this.#handlePlayerStateChange();
  }

  get currentVideoID(): VideoID | null {
    try {
      const videoID = this.#player.getVideoData()?.video_id;
      return typeof videoID === 'string' && videoID.length > 0 ? videoID : null;
    } catch (error) {
      console.warn('[player] Unable to read video metadata', error);
      return null;
    }
  }

  get playerMode() {
    try {
      if (this.#player.isInline()) return PlayerMode.PREVIEW;
      if (this.#player.getVideoStats()?.el === 'shortspage') {
        return PlayerMode.SHORTS;
      }
    } catch (error) {
      console.warn('[player] Unable to read player mode', error);
    }
    return PlayerMode.NORMAL;
  }

  get player(): YTPlayer {
    this.#synchronizePlayer();
    return this.#player;
  }

  get activeVideo(): HTMLVideoElement | null {
    try {
      return resolveActiveVideo(
        this.#player,
        this.#player.ownerDocument ?? document
      );
    } catch (error) {
      console.warn('[player] Unable to resolve active video', error);
      return null;
    }
  }

  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    if (this.#synchronizationToken !== null) {
      window.clearInterval(this.#synchronizationToken);
      this.#synchronizationToken = null;
    }
    try {
      this.#player.removeEventListener(
        'onStateChange',
        this.#handlePlayerStateChange
      );
    } catch (error) {
      console.warn('[player] Unable to detach player during disposal', error);
    }
    this.clearEventListeners();
    if (instance === this) instance = null;
  }
}

let instance: PlayerManager | null = null;
let instancePromise: Promise<PlayerManager> | null = null;
let initializationController: AbortController | null = null;
let instanceGeneration = 0;

export async function getPlayerManager(): Promise<PlayerManager> {
  if (instance) return instance;
  if (!instancePromise) {
    const generation = instanceGeneration;
    const controller =
      typeof AbortController === 'function' ? new AbortController() : null;
    initializationController = controller;
    const pending = getCapablePlayer(
      controller ? { signal: controller.signal } : {}
    )
      .then((player) => {
        if (generation !== instanceGeneration) {
          const error = new Error('Player manager initialization cancelled');
          error.name = 'AbortError';
          throw error;
        }
        instance ??= new PlayerManager(player);
        return instance;
      })
      .finally(() => {
        if (instancePromise === pending) instancePromise = null;
        if (initializationController === controller) {
          initializationController = null;
        }
      });
    instancePromise = pending;
  }
  return instancePromise;
}

export function destroyPlayerManager() {
  instanceGeneration++;
  initializationController?.abort();
  initializationController = null;
  instancePromise = null;
  instance?.destroy();
  instance = null;
}
