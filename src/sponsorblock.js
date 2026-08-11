import sha256 from 'tiny-sha256';
import { configAddChangeListener, configRead } from './config';
import {
  parseSponsorBlockResponse,
  SPONSORBLOCK_CATEGORIES
} from './core/sponsorblock-schema';
import { fetchSponsorBlockJSON } from './core/sponsorblock-client';
import {
  SPONSORBLOCK_CATEGORY_BY_NAME,
  SPONSORBLOCK_CATEGORY_OPTIONS
} from './core/sponsorblock-categories';
import { showNotification } from './ui';

const SPONSORBLOCK_API = 'https://sponsor.ajay.app/api';
const VIDEO_SYNC_DELAY_MS = 100;

/** @typedef {{ category: string, segment: [number, number] }} SponsorSegment */

function findPrimaryVideo() {
  const videos = Array.from(document.querySelectorAll('video'));
  let selected = null;
  let selectedArea = -1;

  for (const video of videos) {
    if (!(video instanceof HTMLVideoElement)) continue;
    const rect = video.getBoundingClientRect();
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    if (area > selectedArea) {
      selected = video;
      selectedArea = area;
    }
  }

  return selected;
}

function findProgressSlider() {
  const progressBars = document.querySelectorAll('[idomkey="progress-bar"]');
  const progressBar = progressBars[progressBars.length - 1];
  if (!(progressBar instanceof HTMLElement)) return null;

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
  syncTimeout = null;
  /** @type {HTMLElement | null} */
  slider = null;
  /** @type {MutationObserver | null} */
  sliderObserver = null;
  /** @type {HTMLDivElement | null} */
  sliderSegmentsOverlay = null;
  /** @type {string | null} */
  overlayKey = null;
  /** @type {MutationObserver | null} */
  documentObserver = null;
  /** @type {unknown} */
  rawResults = null;
  /** @type {SponsorSegment[]} */
  segments = [];

  /** @param {string} videoID */
  constructor(videoID) {
    this.videoID = videoID;
    this.scheduleSkipHandler = () => this.scheduleSkip();
    this.durationChangeHandler = () => {
      this.normalizeSegments();
      this.renderOverlay();
      this.scheduleSkip();
    };
  }

  async init() {
    const videoHash = sha256(this.videoID).substring(0, 4);
    const url = `${SPONSORBLOCK_API}/skipSegments/${videoHash}?categories=${encodeURIComponent(
      JSON.stringify(SPONSORBLOCK_CATEGORIES)
    )}`;
    this.rawResults = await fetchSponsorBlockJSON(url);
    if (!this.active) return;

    if (!document.body) {
      await new Promise((resolve) =>
        document.addEventListener('DOMContentLoaded', resolve, { once: true })
      );
      if (!this.active) return;
    }

    const observer = new MutationObserver(() => this.queueVideoSync());
    this.documentObserver = observer;
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    this.synchronizeVideo();
  }

  queueVideoSync() {
    if (!this.active || this.syncTimeout !== null) return;
    this.syncTimeout = setTimeout(() => {
      this.syncTimeout = null;
      this.synchronizeVideo();
    }, VIDEO_SYNC_DELAY_MS);
  }

  synchronizeVideo() {
    if (!this.active) return;
    const nextVideo = findPrimaryVideo();
    if (nextVideo === this.video) {
      if (nextVideo) this.renderOverlay();
      return;
    }

    this.detachVideo();
    if (!nextVideo) return;

    this.video = nextVideo;
    nextVideo.addEventListener('play', this.scheduleSkipHandler);
    nextVideo.addEventListener('pause', this.scheduleSkipHandler);
    nextVideo.addEventListener('timeupdate', this.scheduleSkipHandler);
    nextVideo.addEventListener('durationchange', this.durationChangeHandler);
    this.normalizeSegments();
    this.renderOverlay();
    this.scheduleSkip();
  }

  normalizeSegments() {
    this.segments = parseSponsorBlockResponse(
      this.rawResults,
      this.videoID,
      this.video?.duration
    );
  }

  getSkippableCategories() {
    return SPONSORBLOCK_CATEGORY_OPTIONS.filter((option) =>
      configRead(option.configKey)
    ).map((option) => option.category);
  }

  /** @param {number} videoDuration */
  createOverlay(videoDuration) {
    const overlay = document.createElement('div');
    overlay.className = 'ytaf-sponsorblock-segment-container';

    for (const {
      category,
      segment: [start, end]
    } of this.segments) {
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
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
      return;
    }

    const target = findProgressSlider();
    if (!target) return;

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
    const slider = target.slider;
    const overlay = this.createOverlay(video.duration);
    this.slider = slider;
    this.sliderSegmentsOverlay = overlay;
    this.overlayKey = overlayKey;
    slider.appendChild(overlay);

    const observer = new MutationObserver(() => {
      if (!this.active) return;
      if (!document.documentElement.contains(slider)) {
        this.removeOverlay();
        this.queueVideoSync();
      } else if (
        this.sliderSegmentsOverlay &&
        !slider.contains(this.sliderSegmentsOverlay)
      ) {
        slider.appendChild(this.sliderSegmentsOverlay);
      }
    });
    this.sliderObserver = observer;
    observer.observe(target.progressBar, {
      childList: true,
      subtree: true
    });
  }

  scheduleSkip() {
    if (this.nextSkipTimeout !== null) clearTimeout(this.nextSkipTimeout);
    this.nextSkipTimeout = null;
    const video = this.video;
    if (!this.active || !video || video.paused) return;

    const allowed = new Set(this.getSkippableCategories());
    const currentTime = video.currentTime;
    const segment = this.segments.find(
      (candidate) =>
        allowed.has(candidate.category) &&
        candidate.segment[1] > currentTime - 0.3
    );
    if (!segment) return;

    const [start, end] = segment.segment;
    this.nextSkipTimeout = setTimeout(
      () => {
        const currentVideo = this.video;
        if (!this.active || !currentVideo || currentVideo.paused) return;
        if (!this.getSkippableCategories().includes(segment.category)) {
          this.scheduleSkip();
          return;
        }

        const label =
          SPONSORBLOCK_CATEGORY_BY_NAME[segment.category]?.name ??
          segment.category;
        showNotification(`Skipping ${label}`, 2000, 'indigo');
        currentVideo.currentTime = Math.min(end, currentVideo.duration);
        this.scheduleSkip();
      },
      Math.max(0, start - currentTime) * 1000
    );
  }

  removeOverlay() {
    this.sliderObserver?.disconnect();
    this.sliderObserver = null;
    this.sliderSegmentsOverlay?.remove();
    this.sliderSegmentsOverlay = null;
    this.overlayKey = null;
    this.slider = null;
  }

  detachVideo() {
    if (this.nextSkipTimeout !== null) clearTimeout(this.nextSkipTimeout);
    this.nextSkipTimeout = null;
    if (this.video) {
      this.video.removeEventListener('play', this.scheduleSkipHandler);
      this.video.removeEventListener('pause', this.scheduleSkipHandler);
      this.video.removeEventListener('timeupdate', this.scheduleSkipHandler);
      this.video.removeEventListener(
        'durationchange',
        this.durationChangeHandler
      );
    }
    this.video = null;
    this.removeOverlay();
  }

  destroy() {
    this.active = false;
    if (this.syncTimeout !== null) clearTimeout(this.syncTimeout);
    this.syncTimeout = null;
    this.documentObserver?.disconnect();
    this.documentObserver = null;
    this.detachVideo();
  }
}

/** @type {SponsorBlockHandler | null} */
let activeHandler = null;

function uninitializeSponsorBlock() {
  activeHandler?.destroy();
  activeHandler = null;
}

function synchronizeSponsorBlock() {
  const currentURL = new URL(location.hash.substring(1), location.href);
  const videoID = currentURL.searchParams.get('v');
  if (
    currentURL.pathname !== '/watch' ||
    !videoID ||
    !configRead('enableSponsorBlock')
  ) {
    uninitializeSponsorBlock();
    return;
  }

  if (activeHandler?.videoID === videoID) return;
  uninitializeSponsorBlock();

  const handler = new SponsorBlockHandler(videoID);
  activeHandler = handler;
  void handler.init().catch((error) => {
    console.warn('[sponsorblock] Initialization failed', error);
    if (activeHandler === handler) uninitializeSponsorBlock();
  });
}

function synchronizeSponsorBlockCategories() {
  activeHandler?.scheduleSkip();
}

window.addEventListener('hashchange', synchronizeSponsorBlock, false);
configAddChangeListener('enableSponsorBlock', synchronizeSponsorBlock);
for (const option of SPONSORBLOCK_CATEGORY_OPTIONS) {
  configAddChangeListener(option.configKey, synchronizeSponsorBlockCategories);
}
window.setTimeout(synchronizeSponsorBlock, 0);
