/*global __YTAF_VERSION__*/
import './spatial-navigation-polyfill.js';
import {
  configAddChangeListener,
  configRead,
  configWrite,
  configGetDesc
} from './config.js';
import './ui.css';
import { requireElement } from './player_api/helpers';
import { SPONSORBLOCK_CATEGORY_OPTIONS } from './core/sponsorblock-categories.js';

// We handle key events ourselves when the bundled polyfill is active.
if (window.__spatialNavigation__) window.__spatialNavigation__.keyMode = 'NONE';

/** @type {Record<number, 'left' | 'right' | 'up' | 'down'>} */
const ARROW_KEY_CODE = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };

const colorCodeMap = new Map([
  [403, 'red'],

  [404, 'green'],
  [172, 'green'],

  [405, 'yellow'],
  [170, 'yellow'],

  [406, 'blue'],
  [167, 'blue'],
  [191, 'blue']
]);

/**
 * Returns the name of the color button associated with a code or null if not a color button.
 * @param {number} charCode KeyboardEvent.charCode property from event
 * @returns {string | null} Color name or null
 */
function getKeyColor(charCode) {
  if (colorCodeMap.has(charCode)) {
    return colorCodeMap.get(charCode) ?? null;
  }

  return null;
}

/** @param {string} key */
function createConfigCheckbox(key) {
  const elmInput = document.createElement('input');
  elmInput.type = 'checkbox';
  elmInput.checked = configRead(key);

  /** @type {(evt: Event) => void} */
  const changeHandler = (_evt) => {
    try {
      configWrite(key, elmInput.checked);
    } catch (error) {
      elmInput.checked = configRead(key);
      console.warn(`[ui] Unable to save "${key}"`, error);
      showNotification('Unable to save setting', 2500, 'red');
    }
  };

  elmInput.addEventListener('change', changeHandler);

  configAddChangeListener(key, (evt) => {
    elmInput.checked = evt.detail.newValue;
  });

  const elmLabel = document.createElement('label');
  elmLabel.appendChild(elmInput);
  // Use non-breaking space (U+00A0)
  elmLabel.appendChild(document.createTextNode('\u00A0' + configGetDesc(key)));

  return elmLabel;
}

function createOptionsPanel() {
  const elmContainer = document.createElement('div');

  elmContainer.classList.add('ytaf-ui-container');
  elmContainer.style['display'] = 'none';
  elmContainer.setAttribute('tabindex', '0');
  elmContainer.setAttribute('role', 'dialog');
  elmContainer.setAttribute('aria-modal', 'true');
  elmContainer.setAttribute('aria-label', 'YouTube AdFree settings');

  elmContainer.addEventListener(
    'focus',
    () => console.debug('Options panel focused!'),
    true
  );
  elmContainer.addEventListener(
    'blur',
    () => console.debug('Options panel blurred!'),
    true
  );

  elmContainer.addEventListener(
    'keydown',
    (evt) => {
      console.debug('Options panel key event:', evt.type, evt.charCode);

      if (getKeyColor(evt.charCode) === 'green') {
        return;
      }

      if (evt.keyCode in ARROW_KEY_CODE && window.navigate) {
        const direction = ARROW_KEY_CODE[evt.keyCode];
        if (direction) window.navigate(direction);
      } else if (evt.keyCode === 9) {
        const focusable = /** @type {HTMLElement[]} */ (
          Array.from(
            elmContainer.querySelectorAll('input, button, [tabindex]')
          ).filter((element) => element instanceof HTMLElement)
        );
        const activeElement = document.activeElement;
        const currentIndex =
          activeElement instanceof HTMLElement
            ? focusable.indexOf(activeElement)
            : -1;
        const direction = evt.shiftKey ? -1 : 1;
        const nextIndex =
          (currentIndex + direction + focusable.length) % focusable.length;
        const next = focusable[nextIndex];
        if (next instanceof HTMLElement) next.focus();
      } else if (evt.keyCode === 13) {
        // "OK" button

        /**
         * The YouTube app generates these "OK" events from clicks (including
         * with the Magic Remote), and we don't want to send a duplicate click
         * event for those. Youtube uses the `Event` class instead of
         * `KeyboardEvent` so we check for that.
         * See issue #143 and #200 for context.
         */
        if (evt instanceof KeyboardEvent) {
          const activeElement = document.activeElement;
          if (activeElement instanceof HTMLElement) activeElement.click();
        }
      } else if (evt.keyCode === 27) {
        // Back button
        showOptionsPanel(false);
      }

      evt.preventDefault();
      evt.stopPropagation();
    },
    true
  );

  const elmHeading = document.createElement('h1');
  elmHeading.textContent = 'YouTube AdFree';
  elmContainer.appendChild(elmHeading);

  elmContainer.appendChild(createConfigCheckbox('enableAdBlock'));
  elmContainer.appendChild(createConfigCheckbox('upgradeThumbnails'));
  elmContainer.appendChild(createConfigCheckbox('hideLogo'));
  elmContainer.appendChild(createConfigCheckbox('showWatch'));
  elmContainer.appendChild(createConfigCheckbox('removeShorts'));
  elmContainer.appendChild(createConfigCheckbox('forceHighResVideo'));
  elmContainer.appendChild(createConfigCheckbox('removeEndscreen'));
  elmContainer.appendChild(createConfigCheckbox('autoAccountSelect'));
  elmContainer.appendChild(createConfigCheckbox('enableSponsorBlock'));

  const elmBlock = document.createElement('blockquote');

  for (const option of SPONSORBLOCK_CATEGORY_OPTIONS) {
    elmBlock.appendChild(createConfigCheckbox(option.configKey));
  }

  elmContainer.appendChild(elmBlock);

  const elmSponsorLink = document.createElement('small');
  elmSponsorLink.className = 'ytaf-ui-sponsor';
  elmSponsorLink.textContent =
    'Sponsor segments skipping - https://sponsor.ajay.app';
  elmContainer.appendChild(elmSponsorLink);

  const version = document.createElement('div');
  version.className = 'ytaf-ui-version';
  version.textContent = `v${__YTAF_VERSION__}`;

  elmContainer.appendChild(version);

  return elmContainer;
}

const optionsPanel = createOptionsPanel();
if (document.body) document.body.appendChild(optionsPanel);
else {
  document.addEventListener(
    'DOMContentLoaded',
    () => document.body.appendChild(optionsPanel),
    { once: true }
  );
}

let optionsPanelVisible = false;
/** @type {Element | null} */
let focusBeforePanel = null;

/**
 * Show or hide the options panel.
 * @param {boolean} [visible=true] Whether to show the options panel.
 */
function showOptionsPanel(visible) {
  visible ??= true;

  if (visible && !optionsPanelVisible) {
    console.debug('Showing and focusing options panel!');
    focusBeforePanel = document.activeElement;
    optionsPanel.style.display = 'block';
    optionsPanel.focus();
    optionsPanelVisible = true;
  } else if (!visible && optionsPanelVisible) {
    console.debug('Hiding options panel!');
    optionsPanel.style.display = 'none';
    optionsPanel.blur();
    if (focusBeforePanel instanceof HTMLElement) focusBeforePanel.focus();
    focusBeforePanel = null;
    optionsPanelVisible = false;
  }
}

window.ytaf_showOptionsPanel = showOptionsPanel;

/** @param {KeyboardEvent} evt */
const eventHandler = (evt) => {
  console.debug(
    'Key event:',
    evt.type,
    evt.charCode,
    evt.keyCode,
    evt.defaultPrevented
  );

  if (getKeyColor(evt.charCode) === 'green') {
    console.debug('Taking over!');

    evt.preventDefault();
    evt.stopPropagation();

    if (evt.type === 'keydown') {
      // Toggle visibility.
      showOptionsPanel(!optionsPanelVisible);
    }
    return false;
  } else if (getKeyColor(evt.charCode) === 'blue') {
    evt.preventDefault();
    evt.stopPropagation();

    if (evt.type === 'keydown') {
      // Toggle Audio-Only mode.
      void initAudioOnlyToggle().catch((error) => {
        console.warn('[screen-hidden] Unable to toggle mode', error);
        showNotification('Screen-hidden mode unavailable', 2000, 'red');
      });
    }
    return false;
  }
  return true;
};

document.addEventListener('keydown', eventHandler, true);
document.addEventListener('keypress', eventHandler, true);
document.addEventListener('keyup', eventHandler, true);

/** @type {Record<string, string>} */
const COLOR_MAP = {
  red: 'rgba(255, 0, 0, 0.9)',
  green: 'rgba(0, 162, 0, 0.9)',
  yellow: 'rgba(255, 255, 0, 0.9)',
  blue: 'rgba(0, 128, 255, 0.9)',
  grey: 'rgba(255, 255, 255, 0.5)',
  none: 'rgba(0, 0, 0, 0)'
};

/** @param {string} text @param {number} time @param {string} color */
export function showNotification(text, time = 3000, color = 'grey') {
  let container = document.querySelector('.ytaf-notification-container');
  if (!(container instanceof HTMLElement)) {
    console.debug('Adding notification container');
    const c = document.createElement('div');
    c.classList.add('ytaf-notification-container');
    c.setAttribute('role', 'status');
    c.setAttribute('aria-live', 'polite');
    document.body.appendChild(c);
    container = c;
  }

  while (container.children.length >= 5) container.firstElementChild?.remove();

  const elm = document.createElement('div');
  const elmInner = document.createElement('div');
  elmInner.innerText = text;
  elmInner.classList.add('message');
  elmInner.classList.add('message-hidden');
  elm.appendChild(elmInner);
  container.appendChild(elm);
  elmInner.style.borderColor = COLOR_MAP[color] || color;

  setTimeout(() => {
    elmInner.classList.remove('message-hidden');
  }, 100);
  setTimeout(() => {
    elmInner.classList.add('message-hidden');
    setTimeout(() => {
      elm.remove();
    }, 1000);
  }, time);
}

/**
 * Initialize ability to hide YouTube logo in top right corner.
 */
function initHideLogo() {
  const style = document.createElement('style');
  document.head.appendChild(style);

  /** @type {(hide: boolean) => void} */
  const setHidden = (hide) => {
    const visibility = hide ? 'hidden' : 'visible';
    style.textContent = `ytlr-redux-connect-ytlr-logo-entity { visibility: ${visibility}; }`;
  };

  setHidden(configRead('hideLogo'));

  configAddChangeListener('hideLogo', (evt) => {
    setHidden(evt.detail.newValue);
  });
}

function applyUIFixes() {
  try {
    const bodyClasses = document.body.classList;

    const observer = new MutationObserver(function bodyClassCallback(
      _records,
      _observer
    ) {
      try {
        if (bodyClasses.contains('app-quality-root')) {
          bodyClasses.remove('app-quality-root');
        }
      } catch (e) {
        console.error('error in <body> class observer callback:', e);
      }
    });

    observer.observe(document.body, {
      subtree: false,
      childList: false,
      attributes: true,
      attributeFilter: ['class'],
      characterData: false
    });
  } catch (e) {
    console.error('error setting up <body> class observer:', e);
  }
}

let audioOnlyEnabled = false;
/** @type {MutationObserver | null} */
let overlayObserver = null;
/** @type {number | null} */
let screenHiddenSyncToken = null;
/** @type {HTMLVideoElement | null} */
let audioOnlyVideo = null;

const AUDIO_OVERLAY_SELECTOR = '.ytLrAudioPlayerOverlayAudioMode';
const YTAF_OVERLAY_CLASS = 'ytaf-ui-watchControl-overlayMessage';

function applyScreenHiddenState() {
  const currentVideo = document.querySelector('video');
  if (audioOnlyVideo && audioOnlyVideo !== currentVideo) {
    audioOnlyVideo.style.visibility = '';
  }
  audioOnlyVideo =
    currentVideo instanceof HTMLVideoElement ? currentVideo : null;
  if (audioOnlyVideo) {
    audioOnlyVideo.style.visibility = audioOnlyEnabled ? 'hidden' : '';
  }

  const audioOverlay = document.querySelector(AUDIO_OVERLAY_SELECTOR);
  if (audioOverlay instanceof HTMLElement) {
    if (audioOnlyEnabled) {
      audioOverlay.style.setProperty('filter', 'brightness(0)', 'important');
    } else {
      audioOverlay.style.removeProperty('filter');
    }
  }

  const controls = document.querySelector('[idomkey="controls"]');
  if (!(controls instanceof HTMLElement)) return;
  const existing = controls.querySelector(`.${YTAF_OVERLAY_CLASS}`);
  if (!audioOnlyEnabled) {
    existing?.remove();
  } else if (!existing) {
    controls.prepend(
      Object.assign(document.createElement('div'), {
        textContent: 'Screen hidden - Press [BLUE] to toggle',
        className: YTAF_OVERLAY_CLASS
      })
    );
  }
}

function queueScreenHiddenState() {
  if (!audioOnlyEnabled || screenHiddenSyncToken !== null) return;
  screenHiddenSyncToken = window.setTimeout(() => {
    screenHiddenSyncToken = null;
    applyScreenHiddenState();
  }, 50);
}

function stopScreenHiddenObserver() {
  overlayObserver?.disconnect();
  overlayObserver = null;
  if (screenHiddenSyncToken !== null) {
    window.clearTimeout(screenHiddenSyncToken);
    screenHiddenSyncToken = null;
  }
}

async function initAudioOnlyToggle() {
  if (!audioOnlyEnabled) {
    await Promise.all([
      requireElement('video', HTMLVideoElement),
      requireElement('[idomkey="controls"]', HTMLElement)
    ]);
  }

  audioOnlyEnabled = !audioOnlyEnabled;
  applyScreenHiddenState();

  showNotification(
    `Screen hidden: ${audioOnlyEnabled ? 'Enabled' : 'Disabled'}`,
    2000,
    'blue'
  );

  stopScreenHiddenObserver();
  if (!audioOnlyEnabled) {
    return;
  }

  overlayObserver = new MutationObserver(queueScreenHiddenState);

  overlayObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function initializeUIFixes() {
  applyUIFixes();
  initHideLogo();
  setTimeout(() => {
    showNotification(
      'Press [GREEN] to open YTAF configuration screen',
      2000,
      'green'
    );
  });
}

if (document.body) initializeUIFixes();
else {
  document.addEventListener('DOMContentLoaded', initializeUIFixes, {
    once: true
  });
}
