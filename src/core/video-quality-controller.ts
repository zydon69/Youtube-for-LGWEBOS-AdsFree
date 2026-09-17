export interface QualityData {
  isPlayable?: boolean;
  qualityLabel?: unknown;
}

export interface QualityPlayer {
  getPlaybackQualityLabel(): string;
  getAvailableQualityData(): QualityData[];
  setPlaybackQualityRange(min: string, max: string): void;
}

export interface QualitySnapshot {
  player: QualityPlayer;
  videoID: string | null;
  preview: boolean;
}

export interface QualityHost {
  read(): QualitySnapshot;
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

interface QualityOperation {
  intervalToken?: unknown;
  timeoutToken?: unknown;
  retryToken?: unknown;
}

interface QualityOwnership {
  player: QualityPlayer;
  confirmed: boolean;
  expectedQuality?: string;
}

/** One operation owns its timers and one snapshot identifies its target. */
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
  #operation: QualityOperation | null = null;
  #applied: QualitySnapshot | null = null;
  #ownership: QualityOwnership | null = null;

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
      if (
        !Number.isFinite(value) ||
        value <= 0 ||
        (name === 'maxAttempts' && !Number.isInteger(value))
      ) {
        throw new RangeError(
          `${name} must be a finite positive ${name === 'maxAttempts' ? 'integer' : 'number'}`
        );
      }
    }
  }

  setEnabled(enabled: boolean) {
    if (this.#disposed || enabled === this.#enabled) return;
    this.#enabled = enabled;
    this.#applied = null;
    this.#cancelOperation();
    if (enabled) this.#start();
    else this.#restoreAutomaticQuality();
  }

  handleNewVideo() {
    if (this.#disposed) return;
    this.#applied = null;
    this.#cancelOperation();
    this.#start();
  }

  handlePlaybackStart() {
    this.#start();
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#enabled = false;
    this.#applied = null;
    this.#cancelOperation();
    this.#restoreAutomaticQuality();
  }

  #isActive(operation: QualityOperation) {
    return !this.#disposed && this.#enabled && this.#operation === operation;
  }

  #finish(operation: QualityOperation) {
    // A callback delivered after cancellation owns only its old timers.
    if (operation.intervalToken !== undefined)
      this.#scheduler.clearInterval(operation.intervalToken);
    if (operation.timeoutToken !== undefined)
      this.#scheduler.clearTimeout(operation.timeoutToken);
    if (operation.retryToken !== undefined)
      this.#scheduler.clearTimeout(operation.retryToken);
    delete operation.intervalToken;
    delete operation.timeoutToken;
    delete operation.retryToken;
    if (this.#operation === operation) this.#operation = null;
  }

  #cancelOperation() {
    const previous = this.#operation;
    this.#operation = null;
    if (previous) this.#finish(previous);
  }

  #start() {
    if (this.#disposed || !this.#enabled || this.#operation) return;
    const operation: QualityOperation = {};
    this.#operation = operation;
    this.#attempt(operation, 1);
  }

  #sameTarget(left: QualitySnapshot, right: QualitySnapshot) {
    return (
      left.player === right.player &&
      left.videoID === right.videoID &&
      left.preview === right.preview
    );
  }

  #attempt(operation: QualityOperation, attempt: number) {
    if (!this.#isActive(operation)) return;
    let snapshot: QualitySnapshot;
    let ownership: QualityOwnership;
    try {
      snapshot = this.#host.read();
      // Reading the host can synchronously announce another video or dispose us.
      if (!this.#isActive(operation)) return;
      if (snapshot.preview || !snapshot.videoID) {
        this.#applied = null;
        this.#finish(operation);
        if (snapshot.preview) this.#restoreAutomaticQuality();
        return;
      }
      if (this.#applied && this.#sameTarget(this.#applied, snapshot)) {
        this.#finish(operation);
        return;
      }
      if (this.#ownership && this.#ownership.player !== snapshot.player) {
        this.#restoreAutomaticQuality();
        if (!this.#isActive(operation)) return;
      }
      ownership = { player: snapshot.player, confirmed: false };
      // Claim the write before calling an API that can dispatch synchronous events.
      // Even a setter that throws after writing must be releasable on shutdown.
      this.#ownership = ownership;
      snapshot.player.setPlaybackQualityRange('highres', 'highres');
      if (!this.#isActive(operation)) return;
    } catch (error) {
      if (!this.#isActive(operation)) return;
      this.#warn('[video-quality] Unable to force high resolution', error);
      if (!this.#isActive(operation)) return;
      if (attempt < this.#maxAttempts) {
        operation.retryToken = this.#scheduler.setTimeout(() => {
          delete operation.retryToken;
          this.#attempt(operation, attempt + 1);
        }, this.#retryDelayMs);
      } else this.#finish(operation);
      return;
    }

    const stillCurrent = () => {
      if (!this.#isActive(operation)) return false;
      const current = this.#host.read();
      return this.#isActive(operation) && this.#sameTarget(snapshot, current);
    };

    operation.intervalToken = this.#scheduler.setInterval(() => {
      try {
        if (!stillCurrent()) {
          this.#finish(operation);
          return;
        }
        const selected = snapshot.player.getPlaybackQualityLabel();
        const maximum = getMaxQualityLabel(snapshot.player);
        if (!stillCurrent()) {
          this.#finish(operation);
          return;
        }
        if (selected !== '' && maximum !== undefined && selected === maximum) {
          if (this.#ownership === ownership) {
            ownership.confirmed = true;
            ownership.expectedQuality = maximum;
          }
          this.#applied = snapshot;
          this.#finish(operation);
          this.#notify(`${selected} selected (Max ${maximum})`, 3_000);
        }
      } catch (error) {
        this.#finish(operation);
        this.#warn('[video-quality] Quality confirmation failed', error);
      }
    }, this.#pollIntervalMs);
    operation.timeoutToken = this.#scheduler.setTimeout(() => {
      delete operation.timeoutToken;
      if (!this.#isActive(operation)) return;
      this.#finish(operation);
      this.#warn(
        '[video-quality] High-resolution selection was not confirmed before timeout'
      );
    }, this.#settleTimeoutMs);
  }

  #restoreAutomaticQuality() {
    const ownership = this.#ownership;
    this.#ownership = null;
    if (!ownership) return;
    try {
      // Preserve a later external selection. Every new video's explicit write
      // has its own confirmation, so a changed maximum is never stale ownership.
      if (
        !ownership.confirmed ||
        ownership.player.getPlaybackQualityLabel() === ownership.expectedQuality
      ) {
        ownership.player.setPlaybackQualityRange('auto', 'auto');
      }
    } catch (error) {
      this.#warn('[video-quality] Unable to restore automatic quality', error);
    }
  }
}
