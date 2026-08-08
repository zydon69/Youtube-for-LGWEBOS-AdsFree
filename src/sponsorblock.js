import sha256 from 'tiny-sha256';
import { configAddChangeListener, configRead } from './config';
import {
  parseSponsorBlockResponse,
  SPONSORBLOCK_CATEGORIES
} from './core/sponsorblock-schema';
import { showNotification } from './ui';

// Copied from https://github.com/ajayyy/SponsorBlock/blob/9392d16617d2d48abb6125c00e2ff6042cb7bebe/src/config.ts#L179-L233
const barTypes = {
  sponsor: {
    color: '#00d400',
    opacity: '0.7',
    name: 'sponsored segment'
  },
  intro: {
    color: '#00ffff',
    opacity: '0.7',
    name: 'intro'
  },
  outro: {
    color: '#0202ed',
    opacity: '0.7',
    name: 'outro'
  },
  interaction: {
    color: '#cc00ff',
    opacity: '0.7',
    name: 'interaction reminder'
  },
  selfpromo: {
    color: '#ffff00',
    opacity: '0.7',
    name: 'self-promotion'
  },
  music_offtopic: {
    color: '#ff9900',
    opacity: '0.7',
    name: 'non-music part'
  },
  preview: {
    color: '#008fd6',
    opacity: '0.7',
    name: 'recap or preview'
  }
};

const sponsorblockAPI = 'https://sponsorblock.inf.re/api';

class SponsorBlockHandler {
  video = null;
  active = true;

  attachVideoTimeout = null;
  nextSkipTimeout = null;

  slider = null;
  sliderInterval = null;
  sliderObserver = null;
  sliderSegmentsOverlay = null;

  scheduleSkipHandler = null;
  durationChangeHandler = null;
  segments = null;
  requestController = null;
  attachDeadline = 0;
  sliderDeadline = 0;

  constructor(videoID) {
    this.videoID = videoID;
  }

  async init() {
    const videoHash = sha256(this.videoID).substring(0, 4);
    const url = `${sponsorblockAPI}/skipSegments/${videoHash}?categories=${encodeURIComponent(
      JSON.stringify(SPONSORBLOCK_CATEGORIES)
    )}`;
    const results = await this.fetchSegments(url);
    if (!this.active) return;

    this.segments = parseSponsorBlockResponse(results, this.videoID);
    if (this.segments.length === 0) {
      console.debug(this.videoID, 'No segments found.');
      return;
    }

    this.scheduleSkipHandler = () => this.scheduleSkip();
    this.durationChangeHandler = () => this.buildOverlay();

    this.attachDeadline = Date.now() + 15_000;
    this.attachVideo();
    this.buildOverlay();
  }

  async fetchSegments(url, attempt = 0) {
    if (!this.active) return [];

    const controller =
      typeof AbortController === 'function' ? new AbortController() : null;
    this.requestController = controller;
    let timeoutToken;

    try {
      const response = await Promise.race([
        fetch(url, controller ? { signal: controller.signal } : undefined),
        new Promise((_, reject) => {
          timeoutToken = setTimeout(() => {
            controller?.abort();
            reject(new Error('SponsorBlock request timed out'));
          }, 8000);
        })
      ]);

      if (!response.ok) {
        throw new Error(`SponsorBlock returned HTTP ${response.status}`);
      }
      return response.json();
    } catch (error) {
      if (!this.active) return [];
      if (attempt >= 2) throw error;

      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      return this.fetchSegments(url, attempt + 1);
    } finally {
      clearTimeout(timeoutToken);
      if (this.requestController === controller) this.requestController = null;
    }
  }

  getSkippableCategories() {
    const skippableCategories = [];
    if (configRead('enableSponsorBlockSponsor')) {
      skippableCategories.push('sponsor');
    }
    if (configRead('enableSponsorBlockIntro')) {
      skippableCategories.push('intro');
    }
    if (configRead('enableSponsorBlockOutro')) {
      skippableCategories.push('outro');
    }
    if (configRead('enableSponsorBlockInteraction')) {
      skippableCategories.push('interaction');
    }
    if (configRead('enableSponsorBlockSelfPromo')) {
      skippableCategories.push('selfpromo');
    }
    if (configRead('enableSponsorBlockMusicOfftopic')) {
      skippableCategories.push('music_offtopic');
    }
    if (configRead('enableSponsorBlockPreview')) {
      skippableCategories.push('preview');
    }
    return skippableCategories;
  }

  attachVideo() {
    clearTimeout(this.attachVideoTimeout);
    this.attachVideoTimeout = null;

    this.video = document.querySelector('video');
    if (!this.video) {
      if (Date.now() >= this.attachDeadline) {
        console.warn(this.videoID, 'Timed out waiting for video element');
        return;
      }
      console.debug(this.videoID, 'No video yet...');
      this.attachVideoTimeout = setTimeout(() => this.attachVideo(), 100);
      return;
    }

    console.debug(this.videoID, 'Video found, binding...');

    this.video.addEventListener('play', this.scheduleSkipHandler);
    this.video.addEventListener('pause', this.scheduleSkipHandler);
    this.video.addEventListener('timeupdate', this.scheduleSkipHandler);
    this.video.addEventListener('durationchange', this.durationChangeHandler);
  }

  buildOverlay() {
    if (this.sliderSegmentsOverlay) {
      console.debug('Overlay already built');
      return;
    }

    if (!this.video || !this.video.duration) {
      console.debug('No video duration yet');
      return;
    }

    const videoDuration = this.video.duration;

    this.sliderSegmentsOverlay = document.createElement('div');
    this.sliderSegmentsOverlay.className =
      'ytaf-sponsorblock-segment-container';

    this.segments.forEach((segment) => {
      const [start, end] = segment.segment;
      const barType = barTypes[segment.category] || {
        color: 'blue'
      };
      const elm = document.createElement('div');
      elm.className = 'ytaf-sponsorblock-segment';
      elm.style['background-color'] = barType.color;
      elm.style['left'] = `${(start / videoDuration) * 100.0}%`;
      elm.style['width'] = `${((end - start) / videoDuration) * 100.0}%`;
      this.sliderSegmentsOverlay.appendChild(elm);
    });

    const addSliderObserver = (ele) => {
      this.sliderObserver.observe(ele, {
        childList: true,
        subtree: true
      });
    };

    const addSliderOverlay = () => {
      this.slider.appendChild(this.sliderSegmentsOverlay);
    };

    const watchForSlider = () => {
      if (this.sliderInterval) clearInterval(this.sliderInterval);
      this.sliderDeadline = Date.now() + 15_000;

      this.sliderInterval = setInterval(() => {
        if (Date.now() >= this.sliderDeadline) {
          clearInterval(this.sliderInterval);
          this.sliderInterval = null;
          console.warn(this.videoID, 'Timed out waiting for progress bar');
          return;
        }

        const nodes = document.querySelectorAll('[idomkey=progress-bar]');
        const last = nodes[nodes.length - 1];
        switch (nodes.length) {
          case 3: {
            // Slider has chapter markers.
            this.slider = last;
            break;
          }
          case 2: {
            // Slider has no markers or auto-markers
            this.slider = last.querySelector('[idomkey=slider]');
            break;
          }
          default: {
            return; // no slider found yet
          }
        }

        console.debug('slider found...', this.slider);
        clearInterval(this.sliderInterval);
        this.sliderInterval = null;
        addSliderObserver(last);
        addSliderOverlay();
      }, 100);
    };

    this.sliderObserver = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        if (m.removedNodes) {
          for (const node of m.removedNodes) {
            if (node === this.sliderSegmentsOverlay) {
              console.debug('bringing back segments overlay');
              addSliderOverlay();
            }
            if (node === this.slider) {
              console.debug('slider removed, watching again');
              this.sliderObserver.disconnect();
              watchForSlider();
            }
          }
        }
      });
    });

    watchForSlider();
  }

  scheduleSkip() {
    clearTimeout(this.nextSkipTimeout);
    this.nextSkipTimeout = null;

    if (!this.active) {
      console.debug(this.videoID, 'No longer active, ignoring...');
      return;
    }

    if (this.video.paused) {
      console.debug(this.videoID, 'Currently paused, ignoring...');
      return;
    }

    // Sometimes timeupdate event (that calls scheduleSkip) gets fired right before
    // already scheduled skip routine below. Let's just look back a little bit
    // and, in worst case, perform a skip at negative interval (immediately)...
    const nextSegments = this.segments.filter(
      (seg) =>
        seg.segment[0] > this.video.currentTime - 0.3 &&
        seg.segment[1] > this.video.currentTime - 0.3
    );
    nextSegments.sort((s1, s2) => s1.segment[0] - s2.segment[0]);

    if (!nextSegments.length) {
      console.debug(this.videoID, 'No more segments');
      return;
    }

    const [segment] = nextSegments;
    const [start, end] = segment.segment;
    console.debug(
      this.videoID,
      'Scheduling skip of',
      segment,
      'in',
      start - this.video.currentTime
    );

    this.nextSkipTimeout = setTimeout(
      () => {
        if (this.video.paused) {
          console.debug(this.videoID, 'Currently paused, ignoring...');
          return;
        }
        if (!this.getSkippableCategories().includes(segment.category)) {
          console.debug(
            this.videoID,
            'Segment',
            segment.category,
            'is not skippable, ignoring...'
          );
          return;
        }

        const skipName = barTypes[segment.category]?.name || segment.category;
        console.debug(this.videoID, 'Skipping', segment);
        showNotification(`Skipping ${skipName}`, 2000, 'indigo');
        this.video.currentTime = end;
        this.scheduleSkip();
      },
      (start - this.video.currentTime) * 1000
    );
  }

  destroy() {
    console.debug(this.videoID, 'Destroying');

    this.active = false;
    this.requestController?.abort();
    this.requestController = null;

    if (this.nextSkipTimeout) {
      clearTimeout(this.nextSkipTimeout);
      this.nextSkipTimeout = null;
    }

    if (this.attachVideoTimeout) {
      clearTimeout(this.attachVideoTimeout);
      this.attachVideoTimeout = null;
    }

    if (this.sliderInterval) {
      clearInterval(this.sliderInterval);
      this.sliderInterval = null;
    }

    if (this.sliderObserver) {
      this.sliderObserver.disconnect();
      this.sliderObserver = null;
    }

    if (this.sliderSegmentsOverlay) {
      this.sliderSegmentsOverlay.remove();
      this.sliderSegmentsOverlay = null;
    }

    if (this.video) {
      this.video.removeEventListener('play', this.scheduleSkipHandler);
      this.video.removeEventListener('pause', this.scheduleSkipHandler);
      this.video.removeEventListener('timeupdate', this.scheduleSkipHandler);
      this.video.removeEventListener(
        'durationchange',
        this.durationChangeHandler
      );
    }
  }
}

// When this global variable was declared using let and two consecutive hashchange
// events were fired (due to bubbling? not sure...) the second call handled below
// would not see the value change from first call, and that would cause multiple
// SponsorBlockHandler initializations... This has been noticed on Chromium 38.
// This either reveals some bug in chromium/webpack/babel scope handling, or
// shows my lack of understanding of javascript. (or both)
window.sponsorblock = null;

function uninitializeSponsorblock() {
  if (!window.sponsorblock) {
    return;
  }
  try {
    window.sponsorblock.destroy();
  } catch (err) {
    console.warn('window.sponsorblock.destroy() failed!', err);
  }
  window.sponsorblock = null;
}

function synchronizeSponsorBlock() {
  const currentURL = new URL(location.hash.substring(1), location.href);
  const videoID = currentURL.searchParams.get('v');
  const enabled = configRead('enableSponsorBlock');

  if (currentURL.pathname !== '/watch' || !videoID || !enabled) {
    uninitializeSponsorblock();
    return;
  }

  if (window.sponsorblock?.videoID === videoID) return;
  uninitializeSponsorblock();

  const handler = new SponsorBlockHandler(videoID);
  window.sponsorblock = handler;
  void handler.init().catch((error) => {
    console.warn('[sponsorblock] Initialization failed', error);
    if (window.sponsorblock === handler) uninitializeSponsorblock();
  });
}

window.addEventListener('hashchange', synchronizeSponsorBlock, false);
configAddChangeListener('enableSponsorBlock', synchronizeSponsorBlock);
window.setTimeout(synchronizeSponsorBlock, 0);
