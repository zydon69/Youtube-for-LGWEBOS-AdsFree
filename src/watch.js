import { configRead, configAddChangeListener } from './config.js';
import './watch.css';
import { subscribeDOMMutations } from './core/dom-mutations.js';

function createClockFormatter() {
  try {
    if (typeof Intl === 'object' && typeof Intl.DateTimeFormat === 'function') {
      return new Intl.DateTimeFormat(navigator.language || undefined, {
        hour: 'numeric',
        minute: 'numeric'
      });
    }
  } catch (error) {
    console.warn('[watch] Locale formatter unavailable', error);
  }
  return null;
}

/** @param {Date} date */
function formatClockFallback(date) {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  return `${hours < 10 ? '0' : ''}${hours}:${minutes < 10 ? '0' : ''}${minutes}`;
}

class Watch {
  /** @type {HTMLDivElement} */
  #watch;
  /** @type {Intl.DateTimeFormat | null} */
  #formatter = createClockFormatter();
  /** @type {number | null} */
  #clockToken = null;
  /** @type {MutationObserver | undefined} */
  #playerObserver;
  /** @type {() => void} */
  #unsubscribeDOM = () => undefined;
  /** @type {HTMLElement | null} */
  #player = null;
  /** @type {number | null} */
  #syncToken = null;
  #destroyed = false;

  constructor() {
    this.#watch = document.createElement('div');
    this.#watch.className = 'webOs-watch';
    this.#watch.setAttribute('aria-hidden', 'true');
    this.#watch.style.pointerEvents = 'none';
    this.#watch.style.zIndex = '999';
    try {
      document.body.appendChild(this.#watch);
      this.#restartClock();
      document.addEventListener(
        'visibilitychange',
        this.#handleVisibilityChange
      );
      window.addEventListener('pageshow', this.#handlePageShow);
      this.#unsubscribeDOM = subscribeDOMMutations(() => this.#queueSync(), {
        delayMs: 25
      });
      this.#synchronizePlayer();
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  #setTime() {
    const now = new Date();
    try {
      this.#watch.innerText =
        this.#formatter?.format(now) ?? formatClockFallback(now);
    } catch {
      this.#formatter = null;
      this.#watch.innerText = formatClockFallback(now);
    }
  }

  #scheduleNextMinute() {
    const now = new Date();
    const delay = (60 - now.getSeconds()) * 1_000 - now.getMilliseconds() + 10;
    this.#clockToken = window.setTimeout(
      () => {
        this.#clockToken = null;
        this.#setTime();
        this.#scheduleNextMinute();
      },
      Math.max(10, delay)
    );
  }

  #restartClock() {
    if (this.#clockToken !== null) window.clearTimeout(this.#clockToken);
    this.#clockToken = null;
    this.#setTime();
    if (!document.hidden) this.#scheduleNextMinute();
  }

  #handleVisibilityChange = () => {
    if (document.hidden) {
      if (this.#clockToken !== null) window.clearTimeout(this.#clockToken);
      this.#clockToken = null;
    } else {
      this.#restartClock();
    }
  };

  #handlePageShow = () => this.#restartClock();

  #queueSync() {
    if (this.#syncToken !== null) return;
    this.#syncToken = window.setTimeout(() => {
      this.#syncToken = null;
      this.#synchronizePlayer();
    }, 100);
  }

  #findCurrentPlayer() {
    const candidates = document.querySelectorAll('ytlr-watch-default');
    for (let index = candidates.length - 1; index >= 0; index--) {
      const candidate = candidates[index];
      if (candidate instanceof HTMLElement) return candidate;
    }
    return null;
  }

  #synchronizePlayer() {
    if (!document.documentElement.contains(this.#watch) && document.body) {
      document.body.appendChild(this.#watch);
    }
    const player = this.#findCurrentPlayer();
    if (player === this.#player) {
      if (!player) this.#watch.style.display = 'block';
      return;
    }
    this.#playerObserver?.disconnect();
    this.#player = player;
    if (!player) {
      this.#watch.style.display = 'block';
      return;
    }
    this.#changeVisibility();
    this.#playerObserver = new MutationObserver(() => this.#changeVisibility());
    this.#playerObserver.observe(player, {
      attributes: true,
      attributeFilter: ['hybridnavfocusable']
    });
  }

  #changeVisibility() {
    const focused = this.#player?.getAttribute('hybridnavfocusable') === 'true';
    this.#watch.style.display = focused ? 'none' : 'block';
  }

  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    if (this.#clockToken !== null) window.clearTimeout(this.#clockToken);
    this.#clockToken = null;
    if (this.#syncToken !== null) window.clearTimeout(this.#syncToken);
    this.#syncToken = null;
    this.#watch.remove();
    this.#playerObserver?.disconnect();
    this.#unsubscribeDOM();
    document.removeEventListener(
      'visibilitychange',
      this.#handleVisibilityChange
    );
    window.removeEventListener('pageshow', this.#handlePageShow);
  }
}

/** @type {Watch | null} */
let watchInstance = null;

/** @param {boolean} show */
function toggleWatch(show) {
  if (show && !watchInstance && document.body) watchInstance = new Watch();
  else if (!show && watchInstance) {
    watchInstance.destroy();
    watchInstance = null;
  }
}

/** @param {CustomEvent<{ newValue: boolean }>} event */
function handleWatchConfigChange(event) {
  toggleWatch(event.detail.newValue);
}

function initializeWatch() {
  toggleWatch(configRead('showWatch'));
}

/** @type {() => void} */
let removeWatchConfigListener = () => {};

try {
  removeWatchConfigListener = configAddChangeListener(
    'showWatch',
    handleWatchConfigChange
  );
  if (document.body) initializeWatch();
  else {
    document.addEventListener('DOMContentLoaded', initializeWatch, {
      once: true
    });
  }
} catch (error) {
  dispose();
  throw error;
}

export function dispose() {
  toggleWatch(false);
  removeWatchConfigListener();
  document.removeEventListener('DOMContentLoaded', initializeWatch);
}
