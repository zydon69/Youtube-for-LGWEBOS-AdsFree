import { configRead, configAddChangeListener } from './config';
import './watch.css';
import { scheduleAlignedInterval } from './core/schedule';

class Watch {
  /** @type {HTMLDivElement} */
  #watch;
  /** @type {(() => void) | undefined} */
  #stopClock;
  /** @type {MutationObserver | undefined} */
  #playerObserver;
  /** @type {MutationObserver} */
  #documentObserver;
  /** @type {HTMLElement | null} */
  #player = null;
  /** @type {number | null} */
  #syncToken = null;

  constructor() {
    this.#watch = document.createElement('div');
    this.#watch.className = 'webOs-watch';
    document.body.appendChild(this.#watch);
    this.#startClock();
    this.#documentObserver = new MutationObserver(() => this.#queueSync());
    this.#documentObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
    this.#synchronizePlayer();
  }

  #startClock() {
    const now = new Date();
    const nextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    const formatter = new Intl.DateTimeFormat(navigator.language, {
      hour: 'numeric',
      minute: 'numeric'
    });
    const setTime = () => {
      this.#watch.innerText = formatter.format(new Date());
    };
    setTime();
    this.#stopClock = scheduleAlignedInterval(setTime, nextMinute, 60_000);
  }

  #queueSync() {
    if (this.#syncToken !== null) return;
    this.#syncToken = window.setTimeout(() => {
      this.#syncToken = null;
      this.#synchronizePlayer();
    }, 100);
  }

  #synchronizePlayer() {
    const candidate = document.querySelector('ytlr-watch-default');
    const player = candidate instanceof HTMLElement ? candidate : null;
    if (player === this.#player) return;
    this.#playerObserver?.disconnect();
    this.#player = player;
    if (!player) return;
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
    this.#stopClock?.();
    if (this.#syncToken !== null) window.clearTimeout(this.#syncToken);
    this.#watch.remove();
    this.#playerObserver?.disconnect();
    this.#documentObserver.disconnect();
  }
}

/** @type {Watch | null} */
let watchInstance = null;

/** @param {boolean} show */
function toggleWatch(show) {
  if (show && !watchInstance) watchInstance = new Watch();
  else if (!show && watchInstance) {
    watchInstance.destroy();
    watchInstance = null;
  }
}

function initializeWatch() {
  toggleWatch(configRead('showWatch'));
}

if (document.body) initializeWatch();
else {
  document.addEventListener('DOMContentLoaded', initializeWatch, {
    once: true
  });
}
configAddChangeListener('showWatch', (event) =>
  toggleWatch(event.detail.newValue)
);
