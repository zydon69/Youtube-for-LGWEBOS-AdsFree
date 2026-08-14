export interface QualityData {
  isPlayable?: boolean;
  qualityLabel?: unknown;
}

export interface QualityPlayer {
  getPlaybackQualityLabel(): string;
  getAvailableQualityData(): QualityData[];
  setPlaybackQualityRange(min: string, max: string): void;
}

export interface QualityHost {
  getPlayer(): QualityPlayer;
  getVideoID(): string | null;
  isPreview(): boolean;
}

export function isQualityPlayer(value: unknown): value is QualityPlayer {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<QualityPlayer>;
  return (
    typeof candidate.getPlaybackQualityLabel === 'function' &&
    typeof candidate.getAvailableQualityData === 'function' &&
    typeof candidate.setPlaybackQualityRange === 'function'
  );
}

interface QualityScheduler {
  setInterval(callback: () => void, delay: number): unknown;
  clearInterval(token: unknown): void;
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(token: unknown): void;
}

interface ControllerOptions {
  scheduler?: QualityScheduler;
  notify?: (message: string, durationMs: number) => void;
  warn?: (message: string, error?: unknown) => void;
  pollIntervalMs?: number;
  settleTimeoutMs?: number;
  retryDelayMs?: number;
  maxAttempts?: number;
}

function qualityRank(label: string) {
  const verticalPixels = Number(label.match(/\d+/)?.[0] ?? 0);
  if (/\b8k\b/i.test(label)) return Math.max(verticalPixels, 4_320);
  if (/\b4k\b/i.test(label)) return Math.max(verticalPixels, 2_160);
  return verticalPixels;
}

export function getMaxQualityLabel(player: QualityPlayer) {
  const qualityData = player.getAvailableQualityData();
  if (!Array.isArray(qualityData)) return undefined;

  let selected: string | undefined;
  let selectedRank = -1;
  for (const entry of qualityData) {
    if (entry?.isPlayable !== true || typeof entry.qualityLabel !== 'string') {
      continue;
    }
    const label = entry.qualityLabel.trim();
    if (label === '') continue;
    const rank = qualityRank(label);
    if (rank > selectedRank) {
      selected = label;
      selectedRank = rank;
    }
  }
  return selected;
}

export class VideoQualityController {
  readonly #host: QualityHost;
  readonly #scheduler: QualityScheduler;
  readonly #notify: NonNullable<ControllerOptions['notify']>;
  readonly #warn: NonNullable<ControllerOptions['warn']>;
  readonly #pollIntervalMs: number;
  readonly #settleTimeoutMs: number;
  readonly #retryDelayMs: number;
  readonly #maxAttempts: number;

  #enabled = false;
  #disposed = false;
  #generation = 0;
  #appliedVideoID: string | null = null;
  #pendingVideoID: string | null = null;
  #intervalToken: unknown;
  #timeoutToken: unknown;
  #retryToken: unknown;
  #ownership:
    | {
        player: QualityPlayer;
        confirmed: boolean;
        expectedQuality?: string;
      }
    | undefined;

  constructor(host: QualityHost, options: ControllerOptions = {}) {
    this.#host = host;
    this.#scheduler = options.scheduler ?? (window as QualityScheduler);
    this.#notify = options.notify ?? (() => undefined);
    this.#warn =
      options.warn ?? ((message, error) => console.warn(message, error));
    this.#pollIntervalMs = options.pollIntervalMs ?? 100;
    this.#settleTimeoutMs = options.settleTimeoutMs ?? 3_000;
    this.#retryDelayMs = options.retryDelayMs ?? 250;
    this.#maxAttempts = options.maxAttempts ?? 3;

    for (const [name, value] of [
      ['pollIntervalMs', this.#pollIntervalMs],
      ['settleTimeoutMs', this.#settleTimeoutMs],
      ['retryDelayMs', this.#retryDelayMs],
      ['maxAttempts', this.#maxAttempts]
    ] as const) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${name} must be a finite positive number`);
      }
      if (name === 'maxAttempts' && !Number.isInteger(value)) {
        throw new RangeError('maxAttempts must be an integer');
      }
    }
  }

  setEnabled(enabled: boolean) {
    if (this.#disposed || enabled === this.#enabled) return;
    this.#enabled = enabled;
    if (enabled) {
      this.#resetOperation();
      this.#tryApply(1);
    } else {
      this.#generation++;
      this.#appliedVideoID = null;
      this.#pendingVideoID = null;
      this.#clearTimers();
      this.#restoreAutomaticQuality();
    }
  }

  handleNewVideo() {
    if (this.#disposed) return;
    try {
      if (this.#host.isPreview()) {
        this.#generation++;
        this.#appliedVideoID = null;
        this.#pendingVideoID = null;
        this.#clearTimers();
        this.#restoreAutomaticQuality();
        return;
      }
    } catch (error) {
      this.#warn('[video-quality] Unable to inspect player mode', error);
    }
    this.#resetOperation();
    if (this.#enabled) this.#tryApply(1);
  }

  handlePlaybackStart() {
    if (this.#disposed || !this.#enabled) return;
    this.#tryApply(1);
  }

  dispose() {
    if (this.#disposed) return;
    if (this.#enabled) this.setEnabled(false);
    this.#disposed = true;
    this.#enabled = false;
    this.#resetOperation();
  }

  #resetOperation() {
    this.#generation++;
    this.#appliedVideoID = null;
    this.#pendingVideoID = null;
    this.#clearTimers();
  }

  #clearTimers() {
    if (this.#intervalToken !== undefined) {
      this.#scheduler.clearInterval(this.#intervalToken);
    }
    if (this.#timeoutToken !== undefined) {
      this.#scheduler.clearTimeout(this.#timeoutToken);
    }
    if (this.#retryToken !== undefined) {
      this.#scheduler.clearTimeout(this.#retryToken);
    }
    this.#intervalToken = undefined;
    this.#timeoutToken = undefined;
    this.#retryToken = undefined;
  }

  #tryApply(attempt: number) {
    if (!this.#enabled || this.#disposed) return;
    if (this.#retryToken !== undefined) {
      this.#scheduler.clearTimeout(this.#retryToken);
      this.#retryToken = undefined;
    }

    const generation = this.#generation;
    let player: QualityPlayer;
    let videoID: string | null;
    let previousQuality: string;
    let maxQuality: string | undefined;
    try {
      if (this.#host.isPreview()) return;
      videoID = this.#host.getVideoID();
      if (
        !videoID ||
        this.#appliedVideoID === videoID ||
        this.#pendingVideoID === videoID
      ) {
        return;
      }
      player = this.#host.getPlayer();
      if (this.#ownership && this.#ownership.player !== player) {
        this.#restoreAutomaticQuality();
      }
      previousQuality = player.getPlaybackQualityLabel();
      maxQuality = getMaxQualityLabel(player);
      if (previousQuality !== '' && previousQuality === maxQuality) {
        this.#appliedVideoID = videoID;
        this.#notifySelection(player);
        return;
      }
      player.setPlaybackQualityRange('highres', 'highres');
    } catch (error) {
      this.#warn('[video-quality] Unable to force high resolution', error);
      if (attempt < this.#maxAttempts) {
        this.#retryToken = this.#scheduler.setTimeout(() => {
          this.#retryToken = undefined;
          if (generation === this.#generation) this.#tryApply(attempt + 1);
        }, this.#retryDelayMs);
      }
      return;
    }

    this.#pendingVideoID = videoID;
    this.#ownership = {
      player,
      confirmed: false
    };

    const isCurrentOperation = () => {
      try {
        return (
          !this.#disposed &&
          this.#enabled &&
          generation === this.#generation &&
          this.#host.getVideoID() === videoID &&
          this.#host.getPlayer() === player
        );
      } catch {
        return false;
      }
    };

    this.#intervalToken = this.#scheduler.setInterval(() => {
      if (!isCurrentOperation()) {
        this.#pendingVideoID = null;
        this.#clearTimers();
        return;
      }
      try {
        const currentQuality = player.getPlaybackQualityLabel();
        const currentMaximum = getMaxQualityLabel(player);
        if (
          currentQuality !== '' &&
          currentMaximum !== undefined &&
          currentQuality === currentMaximum
        ) {
          if (this.#ownership?.player === player) {
            this.#ownership.confirmed = true;
            this.#ownership.expectedQuality = currentMaximum;
          }
          this.#appliedVideoID = videoID;
          this.#pendingVideoID = null;
          this.#clearTimers();
          this.#notifySelection(player);
        }
      } catch (error) {
        this.#pendingVideoID = null;
        this.#clearTimers();
        this.#warn('[video-quality] Quality polling failed', error);
      }
    }, this.#pollIntervalMs);

    this.#timeoutToken = this.#scheduler.setTimeout(() => {
      this.#timeoutToken = undefined;
      if (!isCurrentOperation()) {
        this.#pendingVideoID = null;
        this.#clearTimers();
        return;
      }
      this.#clearTimers();
      this.#pendingVideoID = null;
      this.#warn(
        '[video-quality] High-resolution selection was not confirmed before timeout'
      );
    }, this.#settleTimeoutMs);
  }

  #notifySelection(player: QualityPlayer) {
    if (!this.#enabled || this.#disposed) return;
    try {
      const selected = player.getPlaybackQualityLabel();
      const max = getMaxQualityLabel(player);
      this.#notify(
        `${selected || 'Unknown'} selected (Max ${max || 'Unknown'})`,
        3_000
      );
    } catch (error) {
      this.#warn('[video-quality] Unable to read selected quality', error);
    }
  }

  #restoreAutomaticQuality() {
    const ownership = this.#ownership;
    this.#ownership = undefined;
    if (!ownership) return;

    try {
      const selected = ownership.player.getPlaybackQualityLabel();
      // Before confirmation, our last known operation is still the explicit
      // range write, so release it. After confirmation, preserve a subsequent
      // host/user selection that differs from the value we confirmed.
      const stillOwned =
        !ownership.confirmed ||
        (ownership.expectedQuality !== undefined &&
          selected === ownership.expectedQuality);
      if (stillOwned) {
        ownership.player.setPlaybackQualityRange('auto', 'auto');
      }
    } catch (error) {
      this.#warn('[video-quality] Unable to restore automatic quality', error);
    }
  }
}
