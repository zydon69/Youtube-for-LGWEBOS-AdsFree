import { configRead, configAddChangeListener } from './config';
import './watch.css';
import { scheduleAlignedInterval } from './core/schedule';
import { requireElement } from './player_api/helpers';

class Watch {
  #watch;
  #stopClock;
  #attrChanges;
  #destroyed = false;
  #PLAYER_SELECTOR = 'ytlr-watch-default';

  constructor() {
    this.createElement();
    this.startClock();
    this.playerEvents();
  }

  createElement() {
    this.#watch = document.createElement('div');
    this.#watch.className = 'webOs-watch';
    document.body.appendChild(this.#watch);
  }

  startClock() {
    const nextSeg = (60 - new Date().getSeconds()) * 1000;

    const formatter = new Intl.DateTimeFormat(navigator.language, {
      hour: 'numeric',
      minute: 'numeric'
    });

    const setTime = () => {
      if (this.#destroyed) return;
      this.#watch.innerText = formatter.format(new Date());
    };

    setTime();
    this.#stopClock = scheduleAlignedInterval(setTime, nextSeg, 60_000);
  }

  playerAppear(video) {
    this.changeVisibility(video);
    this.playerObserver(video);
  }

  changeVisibility(video) {
    const focused = video.getAttribute('hybridnavfocusable') === 'true';
    this.#watch.style.display = focused ? 'none' : 'block';
  }

  async playerEvents() {
    try {
      const player = await requireElement(this.#PLAYER_SELECTOR, HTMLElement);
      if (!this.#destroyed) this.playerAppear(player);
    } catch (error) {
      if (!this.#destroyed) {
        console.warn('[watch] Player did not become available', error);
      }
    }
  }

  playerObserver(node) {
    this.#attrChanges = new MutationObserver(() => {
      this.changeVisibility(node);
    });

    this.#attrChanges.observe(node, {
      attributes: true,
      attributeFilter: ['hybridnavfocusable']
    });
  }

  destroy() {
    this.#destroyed = true;
    this.#stopClock?.();
    this.#watch?.remove();
    this.#attrChanges?.disconnect();
  }
}

let watchInstance = null;

function toggleWatch(show) {
  if (show) {
    watchInstance = watchInstance ? watchInstance : new Watch();
  } else {
    watchInstance?.destroy();
    watchInstance = null;
  }
}

toggleWatch(configRead('showWatch'));

configAddChangeListener('showWatch', (evt) => {
  toggleWatch(evt.detail.newValue);
});
