import { configAddChangeListener, configRead } from './config.js';
import {
  isValidSponsorBlockVideoID,
  normalizeSponsorSegments
} from './core/sponsorblock-schema.js';
import {
  SPONSORBLOCK_CATEGORY_BY_NAME,
  SPONSORBLOCK_CATEGORY_OPTIONS
} from './core/sponsorblock-categories.js';
import { showNotification } from './core/notifications.js';
import { resolveActiveVideo } from './core/active-media-resolver.ts';
import { subscribeDOMMutations } from './core/dom-mutations.js';
import {
  computeSponsorDelayMs,
  decideSponsorSkip,
  findNextSponsorSegment
} from './core/sponsorblock-scheduling.js';
import { getPlayerManager } from './player_api/manager.ts';
import {
  clearSponsorBlockSegmentCache,
  loadSponsorSegments
} from './core/sponsorblock-repository.js';

const VIDEO_SYNC_DELAY_MS = 100;
const NAVIGATION_DEBOUNCE_MS = 75;
const MAX_SCHEDULED_DELAY_MS = 2_147_000_000;
const SEEK_CONFIRMATION_TIMEOUT_MS = 750;
const SEEK_RETRY_BASE_DELAY_MS = 500;
const MAX_SEEK_ATTEMPTS_PER_SEGMENT = 3;
const SEEK_EPSILON_SECONDS = 0.25;
const RETRY_BASE_DELAY_MS = 5_000;
const RETRY_MAX_DELAY_MS = 60_000;
const MAX_INITIALIZATION_RETRIES = 4;

/** @typedef {{ category: string, segment: [number, number] }} SponsorSegment */
/** @type {Array<() => void>} */
const configDisposers = [];

let disposed = false;
let installed = false;
/** @type {SponsorBlockHandler | null} */
let activeHandler = null;
/** @type {number | null} */
let navigationDebounceToken = null;
/** @type {number | null} */
let retryToken = null;
let retryAttempt = 0;
/** @type {string | null} */
let queuedVideoID = null;

/** @param {number} milliseconds */
function jitter(milliseconds) {
  return Math.max(0, Math.round(milliseconds * (0.75 + Math.random() * 0.5)));
}

/** @param {import('./player_api/manager.ts').PlayerManager | null} manager */
function readManagerVideoID(manager) {
  try {
    const videoID = manager?.currentVideoID;
    return isValidSponsorBlockVideoID(videoID) ? videoID : null;
  } catch (error) {
    console.warn('[sponsorblock] Unable to read current player video', error);
    return null;
  }
}

/** @param {ParentNode | null | undefined} root */
function queryProgressBars(root) {
  return root?.querySelectorAll?.('[idomkey="progress-bar"]') ?? [];
}

/** @param {ParentNode | null | undefined} playerRoot */
function findProgressSlider(playerRoot) {
  const progressBars = queryProgressBars(playerRoot ?? document);
  let fallback = null;
  let selected = null;
  let selectedArea = -1;

  for (let index = 0; index < progressBars.length; index++) {
    const progressBar = progressBars[index];
    if (!(progressBar instanceof HTMLElement)) continue;
    fallback = progressBar;
    const rect = progressBar.getBoundingClientRect();
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    if (area > selectedArea) {
      selected = progressBar;
      selectedArea = area;
    }
  }

  const progressBar = selected ?? fallback;
  if (!progressBar) return null;
  const nestedSlider = progressBar.querySelector('[idomkey="slider"]');
  const slider =
    nestedSlider instanceof HTMLElement ? nestedSlider : progressBar;
  return { progressBar, slider };
}

export class SponsorBlockHandler {
  /** @type {HTMLVideoElement | null} */
  video = null;
  active = true;
  /** @type {number | null} */
  nextSkipTimeout = null;
  /** @type {number | null} */
  scheduledDueAt = null;
  /** @type {string | null} */
  scheduledSegmentKey = null;
  /** @type {{ key: string, segment: SponsorSegment, target: number, timeoutToken: number } | null} */
  pendingSeek = null;
  /** @type {Map<string, number>} */
  seekAttempts = new Map();
  /** @type {Set<string>} */
  blockedSegments = new Set();
  /** @type {number | null} */
  syncTimeout = null;
  /** @type {HTMLElement | null} */
  progressBar = null;
  /** @type {HTMLElement | null} */
  slider = null;
  /** @type {MutationObserver | null} */
  sliderObserver = null;
  /** @type {HTMLDivElement | null} */
  sliderSegmentsOverlay = null;
  /** @type {string | null} */
  overlayKey = null;
  /** @type {(() => void) | null} */
  unsubscribeDocument = null;
  /** @type {import('./player_api/manager.ts').PlayerManager | null} */
  playerManager = null;
  /** @type {AbortController | null} */
  requestController = null;
  /** @type {EventListener | null} */
  bodyReadyListener = null;
  /** @type {(() => void) | null} */
  bodyReadyResolve = null;
  /** @type {SponsorSegment[]} */
  rawSegments = [];
  /** @type {SponsorSegment[]} */
  segments = [];

  /** @param {string} videoID @param {string[]} categories */
  constructor(videoID, categories) {
    this.videoID = videoID;
    this.categories = [...categories];
    this.scheduleSkipHandler = () => this.handlePlaybackProgress(false);
    this.forceScheduleSkipHandler = () => this.handlePlaybackProgress(true);
    this.durationChangeHandler = () => {
      this.normalizeSegments();
      this.renderOverlay();
      this.scheduleSkip(true);
    };
    this.playerVideoChangeHandler = (
      /** @type {import('./custom-event-target.ts').TypedCustomEvent<string, unknown, 'newVideo'>} */ event
    ) => {
      const detail = event?.detail;
      queueSponsorBlockSynchronization(
        isValidSponsorBlockVideoID(detail)
          ? /** @type {string} */ (detail)
          : null
      );
    };
  }

  waitForDocumentBody() {
    if (document.body) return Promise.resolve();
    return new Promise((resolve) => {
      const complete = () => {
        document.removeEventListener('DOMContentLoaded', complete);
        if (this.bodyReadyListener === complete) {
          this.bodyReadyListener = null;
          this.bodyReadyResolve = null;
        }
        resolve(undefined);
      };
      this.bodyReadyListener = complete;
      this.bodyReadyResolve = complete;
      document.addEventListener('DOMContentLoaded', complete, { once: true });
    });
  }

  cancelBodyWait() {
    const listener = this.bodyReadyListener;
    const resolve = this.bodyReadyResolve;
    this.bodyReadyListener = null;
    this.bodyReadyResolve = null;
    if (listener) document.removeEventListener('DOMContentLoaded', listener);
    resolve?.();
  }

  async init() {
    this.requestController =
      typeof AbortController === 'function' ? new AbortController() : null;
    const manager = await getPlayerManager();
    if (!this.active) return;
    this.playerManager = manager;
    manager.addEventListener('newVideo', this.playerVideoChangeHandler);
    const initialManagerVideoID = readManagerVideoID(manager);
    if (initialManagerVideoID && initialManagerVideoID !== this.videoID) {
      this.destroy();
      queueSponsorBlockSynchronization(initialManagerVideoID);
      return;
    }

    const segments = await loadSponsorSegments(
      this.videoID,
      this.categories,
      this.requestController?.signal
    );
    if (!this.active) return;
    const confirmedManagerVideoID = readManagerVideoID(manager);
    if (confirmedManagerVideoID && confirmedManagerVideoID !== this.videoID) {
      this.destroy();
      queueSponsorBlockSynchronization(confirmedManagerVideoID);
      return;
    }
    this.rawSegments = segments;

    if (!document.body) {
      await this.waitForDocumentBody();
      if (!this.active) return;
    }

    this.unsubscribeDocument = subscribeDOMMutations(
      () => this.queueVideoSync(),
      { delayMs: 25 }
    );
    this.synchronizeVideo();
  }

  queueVideoSync() {
    if (!this.active || this.syncTimeout !== null) return;
    this.syncTimeout = window.setTimeout(() => {
      this.syncTimeout = null;
      this.synchronizeVideo();
    }, VIDEO_SYNC_DELAY_MS);
  }

  synchronizeVideo() {
    if (!this.active) return;
    const managerVideoID = readManagerVideoID(this.playerManager);
    if (managerVideoID && managerVideoID !== this.videoID) {
      this.detachVideo();
      queueSponsorBlockSynchronization(managerVideoID);
      return;
    }

    let playerRoot = null;
    try {
      playerRoot = this.playerManager?.player ?? null;
    } catch (error) {
      console.warn('[sponsorblock] Player root unavailable', error);
    }
    const nextVideo = resolveActiveVideo(playerRoot);
    if (nextVideo === this.video) {
      if (nextVideo) this.renderOverlay();
      return;
    }

    this.detachVideo();
    if (!nextVideo) return;
    this.video = nextVideo;
    nextVideo.addEventListener('play', this.forceScheduleSkipHandler);
    nextVideo.addEventListener('pause', this.forceScheduleSkipHandler);
    nextVideo.addEventListener('timeupdate', this.scheduleSkipHandler);
    nextVideo.addEventListener('durationchange', this.durationChangeHandler);
    nextVideo.addEventListener('loadedmetadata', this.durationChangeHandler);
    nextVideo.addEventListener('ratechange', this.forceScheduleSkipHandler);
    nextVideo.addEventListener('seeking', this.forceScheduleSkipHandler);
    nextVideo.addEventListener('seeked', this.forceScheduleSkipHandler);
    nextVideo.addEventListener('emptied', this.forceScheduleSkipHandler);
    this.normalizeSegments();
    this.renderOverlay();
    this.scheduleSkip(true);
  }

  normalizeSegments() {
    this.segments = normalizeSponsorSegments(
      this.rawSegments,
      this.video?.duration
    );
  }

  /** @param {number} videoDuration */
  createOverlay(videoDuration) {
    const overlay = document.createElement('div');
    overlay.className = 'ytaf-sponsorblock-segment-container';
    overlay.setAttribute('aria-hidden', 'true');
    for (const {
      category,
      segment: [start, end]
    } of this.segments) {
      if (!this.categories.includes(category)) continue;
      const style = SPONSORBLOCK_CATEGORY_BY_NAME[category];
      if (!style) continue;
      const element = document.createElement('div');
      element.className = 'ytaf-sponsorblock-segment';
      element.style.backgroundColor = style.color;
      element.style.left = `${(start / videoDuration) * 100}%`;
      element.style.width = `${((end - start) / videoDuration) * 100}%`;
      overlay.appendChild(element);
    }
    return overlay;
  }

  renderOverlay() {
    const video = this.video;
    if (
      !video ||
      this.segments.length === 0 ||
      !Number.isFinite(video.duration) ||
      video.duration <= 0
    ) {
      this.removeOverlay();
      return;
    }

    let playerRoot = null;
    try {
      playerRoot = this.playerManager?.player ?? null;
    } catch {
      // A player without a usable root must not attach an overlay to an
      // unrelated preview's global progress bar.
    }
    const target = findProgressSlider(playerRoot);
    if (!target) {
      this.removeOverlay();
      return;
    }

    const overlayKey = `${video.duration}:${JSON.stringify(this.segments)}`;
    if (
      this.slider === target.slider &&
      this.overlayKey === overlayKey &&
      this.sliderSegmentsOverlay &&
      target.slider.contains(this.sliderSegmentsOverlay)
    ) {
      return;
    }

    this.removeOverlay();
    const overlay = this.createOverlay(video.duration);
    this.progressBar = target.progressBar;
    this.slider = target.slider;
    this.sliderSegmentsOverlay = overlay;
    this.overlayKey = overlayKey;
    this.progressBar.classList.add('ytaf-sponsorblock-active');
    this.slider.classList.add('ytaf-sponsorblock-active');
    this.slider.appendChild(overlay);

    this.sliderObserver = new MutationObserver(() => {
      if (!this.active || !this.slider || !this.sliderSegmentsOverlay) return;
      if (!document.documentElement.contains(this.slider)) {
        this.removeOverlay();
        this.queueVideoSync();
      } else if (!this.slider.contains(this.sliderSegmentsOverlay)) {
        this.slider.appendChild(this.sliderSegmentsOverlay);
      }
    });
    this.sliderObserver.observe(this.progressBar, {
      childList: true,
      subtree: true
    });
  }

  clearScheduledSkip() {
    if (this.nextSkipTimeout !== null) {
      window.clearTimeout(this.nextSkipTimeout);
    }
    this.nextSkipTimeout = null;
    this.scheduledDueAt = null;
    this.scheduledSegmentKey = null;
  }

  clearPendingSeek() {
    if (this.pendingSeek) {
      window.clearTimeout(this.pendingSeek.timeoutToken);
    }
    this.pendingSeek = null;
  }

  /** @param {SponsorSegment} segment */
  segmentKey(segment) {
    return `${segment.category}:${segment.segment[0]}:${segment.segment[1]}`;
  }

  /** @param {number} currentTime */
  pruneBlockedSegments(currentTime) {
    for (const key of this.blockedSegments) {
      const segment = this.segments.find(
        (candidate) => this.segmentKey(candidate) === key
      );
      if (
        !segment ||
        currentTime < segment.segment[0] - SEEK_EPSILON_SECONDS ||
        currentTime >= segment.segment[1] - SEEK_EPSILON_SECONDS
      ) {
        this.blockedSegments.delete(key);
        this.seekAttempts.delete(key);
      }
    }
  }

  /** @param {SponsorSegment} segment */
  notifySkipped(segment) {
    const label =
      SPONSORBLOCK_CATEGORY_BY_NAME[segment.category]?.name ?? segment.category;
    showNotification(`Skipping ${label}`, 2000, 'indigo');
  }

  settlePendingSeek() {
    const pending = this.pendingSeek;
    const video = this.video;
    if (!pending || !video) return false;
    const currentTime = video.currentTime;
    if (
      Number.isFinite(currentTime) &&
      currentTime >= pending.target - SEEK_EPSILON_SECONDS
    ) {
      this.clearPendingSeek();
      this.seekAttempts.delete(pending.key);
      this.blockedSegments.delete(pending.key);
      this.notifySkipped(pending.segment);
      this.scheduleSkip(true);
    }
    return true;
  }

  /** @param {boolean} force */
  handlePlaybackProgress(force) {
    if (this.settlePendingSeek()) return;
    this.scheduleSkip(force);
  }

  /** @param {SponsorSegment} segment @param {unknown} [error] */
  recordSeekFailure(segment, error) {
    this.clearPendingSeek();
    const key = this.segmentKey(segment);
    const attempts = (this.seekAttempts.get(key) ?? 0) + 1;
    this.seekAttempts.set(key, attempts);
    if (error) {
      console.warn('[sponsorblock] Unable to seek over segment', error);
    }
    if (attempts >= MAX_SEEK_ATTEMPTS_PER_SEGMENT) {
      this.blockedSegments.add(key);
      this.scheduleSkip(true);
      return;
    }
    this.clearScheduledSkip();
    this.scheduledSegmentKey = key;
    const delay = SEEK_RETRY_BASE_DELAY_MS * 2 ** (attempts - 1);
    this.scheduledDueAt = Date.now() + delay;
    this.nextSkipTimeout = window.setTimeout(() => {
      this.nextSkipTimeout = null;
      this.scheduledDueAt = null;
      this.scheduledSegmentKey = null;
      this.executeScheduledSkip(segment);
    }, delay);
  }

  /** @param {SponsorSegment} segment @param {number} target */
  awaitSeekConfirmation(segment, target) {
    this.clearScheduledSkip();
    const key = this.segmentKey(segment);
    const timeoutToken = window.setTimeout(() => {
      if (this.pendingSeek?.key !== key) return;
      this.recordSeekFailure(
        segment,
        new Error('SponsorBlock seek made no observable progress')
      );
    }, SEEK_CONFIRMATION_TIMEOUT_MS);
    this.pendingSeek = { key, segment, target, timeoutToken };
  }

  /** @param {boolean} force */
  scheduleSkip(force = false) {
    const video = this.video;
    if (
      !this.active ||
      !video ||
      video.paused ||
      !Number.isFinite(video.currentTime)
    ) {
      this.clearScheduledSkip();
      return;
    }

    if (this.pendingSeek) return;
    this.pruneBlockedSegments(video.currentTime);

    const allowed = new Set(this.categories);
    const segment = findNextSponsorSegment(
      this.segments.filter(
        (candidate) => !this.blockedSegments.has(this.segmentKey(candidate))
      ),
      allowed,
      video.currentTime
    );
    if (!segment) {
      this.clearScheduledSkip();
      return;
    }
    const delay = computeSponsorDelayMs(
      segment.segment[0],
      video.currentTime,
      video.playbackRate
    );
    if (delay === null) {
      this.clearScheduledSkip();
      return;
    }

    const segmentKey = this.segmentKey(segment);
    const dueAt = Date.now() + delay;
    if (
      !force &&
      this.nextSkipTimeout !== null &&
      this.scheduledSegmentKey === segmentKey &&
      this.scheduledDueAt !== null &&
      Math.abs(this.scheduledDueAt - dueAt) < 500
    ) {
      return;
    }

    this.clearScheduledSkip();
    this.scheduledSegmentKey = segmentKey;
    this.scheduledDueAt = dueAt;
    this.nextSkipTimeout = window.setTimeout(
      () => this.executeScheduledSkip(segment),
      Math.min(delay, MAX_SCHEDULED_DELAY_MS)
    );
  }

  /** @param {SponsorSegment} segment */
  executeScheduledSkip(segment) {
    this.nextSkipTimeout = null;
    this.scheduledDueAt = null;
    this.scheduledSegmentKey = null;
    if (this.pendingSeek) return;
    const video = this.video;
    if (!this.active || !video || video.paused) return;
    const managerVideoID = readManagerVideoID(this.playerManager);
    if (managerVideoID && managerVideoID !== this.videoID) {
      this.detachVideo();
      queueSponsorBlockSynchronization(managerVideoID);
      return;
    }
    if (!this.categories.includes(segment.category)) {
      this.scheduleSkip(true);
      return;
    }

    const decision = decideSponsorSkip(
      segment.segment,
      video.currentTime,
      video.duration
    );
    if (!decision || 'reschedule' in decision) {
      this.scheduleSkip(true);
      return;
    }

    try {
      video.currentTime = decision.target;
    } catch (error) {
      this.recordSeekFailure(segment, error);
      return;
    }
    if (video.currentTime >= decision.target - SEEK_EPSILON_SECONDS) {
      this.seekAttempts.delete(this.segmentKey(segment));
      this.notifySkipped(segment);
      this.scheduleSkip(true);
      return;
    }
    this.awaitSeekConfirmation(segment, decision.target);
  }

  removeOverlay() {
    this.sliderObserver?.disconnect();
    this.sliderObserver = null;
    this.sliderSegmentsOverlay?.remove();
    this.sliderSegmentsOverlay = null;
    this.progressBar?.classList.remove('ytaf-sponsorblock-active');
    this.slider?.classList.remove('ytaf-sponsorblock-active');
    this.progressBar = null;
    this.slider = null;
    this.overlayKey = null;
  }

  detachVideo() {
    this.clearScheduledSkip();
    this.clearPendingSeek();
    this.seekAttempts.clear();
    this.blockedSegments.clear();
    if (this.video) {
      this.video.removeEventListener('play', this.forceScheduleSkipHandler);
      this.video.removeEventListener('pause', this.forceScheduleSkipHandler);
      this.video.removeEventListener('timeupdate', this.scheduleSkipHandler);
      this.video.removeEventListener(
        'durationchange',
        this.durationChangeHandler
      );
      this.video.removeEventListener(
        'loadedmetadata',
        this.durationChangeHandler
      );
      this.video.removeEventListener(
        'ratechange',
        this.forceScheduleSkipHandler
      );
      this.video.removeEventListener('seeking', this.forceScheduleSkipHandler);
      this.video.removeEventListener('seeked', this.forceScheduleSkipHandler);
      this.video.removeEventListener('emptied', this.forceScheduleSkipHandler);
    }
    this.video = null;
    this.removeOverlay();
  }

  destroy() {
    if (!this.active) return;
    this.active = false;
    this.requestController?.abort();
    this.requestController = null;
    this.cancelBodyWait();
    if (this.syncTimeout !== null) window.clearTimeout(this.syncTimeout);
    this.syncTimeout = null;
    this.unsubscribeDocument?.();
    this.unsubscribeDocument = null;
    this.playerManager?.removeEventListener(
      'newVideo',
      this.playerVideoChangeHandler
    );
    this.playerManager = null;
    this.detachVideo();
  }
}

function uninitializeSponsorBlock() {
  activeHandler?.destroy();
  activeHandler = null;
}

function readWatchRoute() {
  try {
    const currentURL = new URL(location.hash.substring(1), location.href);
    return currentURL.pathname === '/watch' ? currentURL : null;
  } catch {
    return null;
  }
}

function clearRetry() {
  if (retryToken !== null) window.clearTimeout(retryToken);
  retryToken = null;
}

/** @param {string} videoID @param {unknown} error */
function scheduleInitializationRetry(videoID, error) {
  if (disposed) return;
  if (
    error instanceof Error &&
    /** @type {Error & { retryable?: boolean }} */ (error).retryable === false
  ) {
    return;
  }
  if (retryAttempt >= MAX_INITIALIZATION_RETRIES) {
    console.warn(
      '[sponsorblock] Retry budget exhausted; waiting for navigation or configuration change'
    );
    return;
  }
  clearRetry();
  const baseDelay = Math.min(
    RETRY_BASE_DELAY_MS * 2 ** retryAttempt,
    RETRY_MAX_DELAY_MS
  );
  const delay = jitter(baseDelay);
  retryAttempt++;
  retryToken = window.setTimeout(() => {
    retryToken = null;
    synchronizeSponsorBlock(videoID, true);
  }, delay);
}

/** @param {string | null} [videoIDOverride] @param {boolean} [fromRetry] */
function synchronizeSponsorBlock(videoIDOverride = null, fromRetry = false) {
  if (disposed) return;
  clearRetry();
  if (!fromRetry) retryAttempt = 0;

  const route = readWatchRoute();
  const routeVideoID = route?.searchParams.get('v') ?? null;
  if (
    fromRetry &&
    isValidSponsorBlockVideoID(videoIDOverride) &&
    routeVideoID !== videoIDOverride
  ) {
    uninitializeSponsorBlock();
    return;
  }
  const videoID = isValidSponsorBlockVideoID(videoIDOverride)
    ? videoIDOverride
    : routeVideoID;
  const categories = SPONSORBLOCK_CATEGORY_OPTIONS.filter((option) =>
    configRead(option.configKey)
  ).map((option) => option.category);

  if (
    !route ||
    !isValidSponsorBlockVideoID(videoID) ||
    !configRead('enableSponsorBlock') ||
    categories.length === 0
  ) {
    uninitializeSponsorBlock();
    return;
  }

  const confirmedVideoID = /** @type {string} */ (videoID);
  const categoriesKey = categories.join(',');
  if (
    activeHandler?.videoID === videoID &&
    activeHandler.categories.join(',') === categoriesKey
  ) {
    activeHandler.queueVideoSync();
    return;
  }

  uninitializeSponsorBlock();
  const handler = new SponsorBlockHandler(confirmedVideoID, categories);
  activeHandler = handler;
  void handler.init().catch((error) => {
    if (activeHandler !== handler) return;
    handler.destroy();
    activeHandler = null;
    if (!(error instanceof Error) || error.name !== 'AbortError') {
      console.warn('[sponsorblock] Initialization failed', error);
      scheduleInitializationRetry(confirmedVideoID, error);
    }
  });
}

/** @param {string | null} [videoID] */
function queueSponsorBlockSynchronization(videoID = null) {
  if (disposed) return;
  if (isValidSponsorBlockVideoID(videoID)) queuedVideoID = videoID;
  if (navigationDebounceToken !== null) {
    window.clearTimeout(navigationDebounceToken);
  }
  navigationDebounceToken = window.setTimeout(() => {
    navigationDebounceToken = null;
    const override = queuedVideoID;
    queuedVideoID = null;
    synchronizeSponsorBlock(override);
  }, NAVIGATION_DEBOUNCE_MS);
}

function handleNavigation() {
  queuedVideoID = null;
  queueSponsorBlockSynchronization();
}

export function installSponsorBlock() {
  if (installed) return;
  disposed = false;
  installed = true;
  try {
    window.addEventListener('hashchange', handleNavigation, false);
    window.addEventListener('popstate', handleNavigation, false);
    window.addEventListener('online', handleNavigation, false);
    configDisposers.push(
      configAddChangeListener('enableSponsorBlock', handleNavigation)
    );
    for (const option of SPONSORBLOCK_CATEGORY_OPTIONS) {
      configDisposers.push(
        configAddChangeListener(option.configKey, handleNavigation)
      );
    }
    queueSponsorBlockSynchronization();
  } catch (error) {
    dispose();
    throw error;
  }
}

export function dispose() {
  if (disposed && !installed) return;
  disposed = true;
  installed = false;
  if (navigationDebounceToken !== null) {
    window.clearTimeout(navigationDebounceToken);
    navigationDebounceToken = null;
  }
  clearRetry();
  retryAttempt = 0;
  queuedVideoID = null;
  uninitializeSponsorBlock();
  clearSponsorBlockSegmentCache();
  for (const removeListener of configDisposers.splice(0)) removeListener();
  window.removeEventListener('hashchange', handleNavigation, false);
  window.removeEventListener('popstate', handleNavigation, false);
  window.removeEventListener('online', handleNavigation, false);
}
