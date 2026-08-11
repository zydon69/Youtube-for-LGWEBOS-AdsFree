/*global __YTAF_VERSION__*/
import './spatial-navigation-polyfill.js';
import {
  configAddChangeListener,
  configRead,
  configWrite,
  configGetDesc
} from './config.js';
import './ui.css';
import { SPONSORBLOCK_CATEGORY_OPTIONS } from './core/sponsorblock-categories.js';
import { resolveActiveVideo } from './core/active-media-resolver.ts';
import {
  acquireTransactionalOwnership,
  InlineStyleOwner
} from './core/inline-style-owner.js';
import { subscribeDOMMutations } from './core/dom-mutations.js';

const spatialNavigation = window.__spatialNavigation__;
const previousSpatialKeyMode = spatialNavigation?.keyMode;
const hadOwnSpatialKeyMode = spatialNavigation
  ? Object.hasOwn(spatialNavigation, 'keyMode')
  : false;
let ownsSpatialKeyMode = false;
try {
  if (spatialNavigation) {
    spatialNavigation.keyMode = 'NONE';
    ownsSpatialKeyMode = spatialNavigation.keyMode === 'NONE';
  }
} catch (error) {
  console.warn('[ui] Unable to configure spatial navigation', error);
}

function restoreSpatialNavigation() {
  if (
    !ownsSpatialKeyMode ||
    !spatialNavigation ||
    spatialNavigation.keyMode !== 'NONE'
  ) {
    return;
  }
  try {
    if (previousSpatialKeyMode !== undefined) {
      spatialNavigation.keyMode = previousSpatialKeyMode;
    } else if (!hadOwnSpatialKeyMode) {
      Reflect.deleteProperty(spatialNavigation, 'keyMode');
    }
    ownsSpatialKeyMode = false;
  } catch (error) {
    console.warn('[ui] Unable to restore spatial navigation', error);
  }
}

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
/** @type {Record<string, string>} */
const COLOR_MAP = {
  red: 'rgba(255, 0, 0, 0.9)',
  green: 'rgba(0, 162, 0, 0.9)',
  yellow: 'rgba(255, 255, 0, 0.9)',
  blue: 'rgba(0, 128, 255, 0.9)',
  indigo: 'rgba(75, 0, 130, 0.9)',
  grey: 'rgba(255, 255, 255, 0.5)',
  none: 'rgba(0, 0, 0, 0)'
};
const AUDIO_OVERLAY_SELECTOR = '.ytLrAudioPlayerOverlayAudioMode';
const YTAF_OVERLAY_CLASS = 'ytaf-ui-watchControl-overlayMessage';
const PANEL_HEADING_ID = 'ytaf-settings-heading';
const SPONSOR_DESCRIPTION_ID = 'ytaf-sponsor-description';

/** @type {Array<() => void>} */
const configDisposers = [];
/** @type {Map<HTMLElement, number[]>} */
const notificationTimers = new Map();
/** @type {Map<Element, string | null>} */
const backgroundAriaState = new Map();

let disposed = false;
let initialized = false;
let optionsPanelVisible = false;
/** @type {Element | null} */
let focusBeforePanel = null;
/** @type {MutationObserver | null} */
let modalBodyObserver = null;
/** @type {MutationObserver | null} */
let bodyClassObserver = null;
/** @type {HTMLElement | null} */
let observedBody = null;
/** @type {(() => void) | null} */
let unsubscribeUIBodyDOM = null;
/** @type {HTMLStyleElement | null} */
let logoStyle = null;
/** @type {number | null} */
let introNotificationTimer = null;

let audioOnlyEnabled = false;
/** @type {(() => void) | null} */
let unsubscribeScreenHiddenDOM = null;
/** @type {number | null} */
let screenHiddenSyncToken = null;
/** @type {HTMLVideoElement | null} */
let audioOnlyVideo = null;
/** @type {InlineStyleOwner | null} */
let audioOnlyVideoStyles = null;
/** @type {HTMLElement | null} */
let audioOnlyOverlay = null;
/** @type {InlineStyleOwner | null} */
let audioOnlyOverlayStyles = null;
/** @type {HTMLElement | null} */
let screenHiddenMessage = null;
let audioOnlyToggleQueue = Promise.resolve();

/** @param {KeyboardEvent} event */
function getEventCode(event) {
  return event.keyCode || event.which || event.charCode || 0;
}

/** @param {KeyboardEvent} event */
function getKeyColor(event) {
  return colorCodeMap.get(getEventCode(event)) ?? null;
}

function getFocusablePanelElements() {
  return /** @type {HTMLElement[]} */ (
    Array.from(
      optionsPanel.querySelectorAll('input, button, select, [tabindex]')
    ).filter(
      (element) =>
        element instanceof HTMLElement &&
        !element.hasAttribute('disabled') &&
        element.getAttribute('aria-hidden') !== 'true'
    )
  );
}

/** @param {string} key @param {{ describedBy?: string }} [options] */
function createConfigCheckbox(key, { describedBy } = {}) {
  const elmInput = document.createElement('input');
  elmInput.type = 'checkbox';
  elmInput.checked = configRead(key);
  if (describedBy) elmInput.setAttribute('aria-describedby', describedBy);

  const changeHandler = () => {
    try {
      configWrite(key, elmInput.checked);
    } catch (error) {
      elmInput.checked = configRead(key);
      console.warn(`[ui] Unable to save "${key}"`, error);
      showNotification('Unable to save setting', 2500, 'red');
    }
  };
  elmInput.addEventListener('change', changeHandler);
  configDisposers.push(() =>
    elmInput.removeEventListener('change', changeHandler)
  );
  configDisposers.push(
    configAddChangeListener(key, (event) => {
      elmInput.checked = event.detail.newValue;
    })
  );

  const elmLabel = document.createElement('label');
  elmLabel.appendChild(elmInput);
  elmLabel.appendChild(document.createTextNode(`\u00a0${configGetDesc(key)}`));
  return elmLabel;
}

function createOptionsPanel() {
  const container = document.createElement('div');
  container.className = 'ytaf-ui-container';
  container.style.display = 'none';
  container.style.overflowY = 'auto';
  container.style.boxSizing = 'border-box';
  container.setAttribute('tabindex', '-1');
  container.setAttribute('role', 'dialog');
  container.setAttribute('aria-modal', 'true');
  container.setAttribute('aria-labelledby', PANEL_HEADING_ID);
  container.setAttribute('aria-hidden', 'true');

  const heading = document.createElement('h1');
  heading.id = PANEL_HEADING_ID;
  heading.textContent = 'YouTube AdFree';
  container.appendChild(heading);

  container.appendChild(createConfigCheckbox('enableAdBlock'));
  container.appendChild(createConfigCheckbox('upgradeThumbnails'));
  container.appendChild(createConfigCheckbox('hideLogo'));
  container.appendChild(createConfigCheckbox('showWatch'));
  container.appendChild(createConfigCheckbox('removeShorts'));
  container.appendChild(createConfigCheckbox('forceHighResVideo'));
  container.appendChild(createConfigCheckbox('removeEndscreen'));
  container.appendChild(createConfigCheckbox('autoAccountSelect'));
  container.appendChild(
    createConfigCheckbox('enableSponsorBlock', {
      describedBy: SPONSOR_DESCRIPTION_ID
    })
  );

  const categoryGroup = document.createElement('fieldset');
  const categoryLegend = document.createElement('legend');
  categoryLegend.textContent = 'SponsorBlock categories';
  categoryGroup.appendChild(categoryLegend);
  for (const option of SPONSORBLOCK_CATEGORY_OPTIONS) {
    categoryGroup.appendChild(createConfigCheckbox(option.configKey));
  }
  container.appendChild(categoryGroup);

  const sponsorDescription = document.createElement('small');
  sponsorDescription.id = SPONSOR_DESCRIPTION_ID;
  sponsorDescription.className = 'ytaf-ui-sponsor';
  sponsorDescription.textContent =
    'Sponsor segments: data provided by sponsor.ajay.app';
  container.appendChild(sponsorDescription);

  const version = document.createElement('div');
  version.className = 'ytaf-ui-version';
  version.textContent = `v${__YTAF_VERSION__}`;
  container.appendChild(version);
  return container;
}

const optionsPanel = (() => {
  try {
    return createOptionsPanel();
  } catch (error) {
    for (const removeListener of configDisposers.splice(0)) {
      try {
        removeListener();
      } catch (cleanupError) {
        console.warn(
          '[ui] Unable to roll back a settings listener',
          cleanupError
        );
      }
    }
    restoreSpatialNavigation();
    throw error;
  }
})();

function restoreModalBackground() {
  modalBodyObserver?.disconnect();
  modalBodyObserver = null;
  for (const [element, previous] of backgroundAriaState) {
    if (element.getAttribute('aria-hidden') !== 'true') continue;
    if (previous === null) element.removeAttribute('aria-hidden');
    else element.setAttribute('aria-hidden', previous);
  }
  backgroundAriaState.clear();
}

/** @param {Element} element */
function hideModalSibling(element) {
  if (
    element === optionsPanel ||
    element.classList.contains('ytaf-notification-container')
  ) {
    return;
  }
  if (!backgroundAriaState.has(element)) {
    backgroundAriaState.set(element, element.getAttribute('aria-hidden'));
  }
  element.setAttribute('aria-hidden', 'true');
}

function hideModalBackground() {
  restoreModalBackground();
  if (!document.body) return;
  for (let index = 0; index < document.body.children.length; index++) {
    const child = document.body.children[index];
    if (child) hideModalSibling(child);
  }
  modalBodyObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (let index = 0; index < mutation.addedNodes.length; index++) {
        const node = mutation.addedNodes[index];
        if (node instanceof Element && node.parentElement === document.body) {
          hideModalSibling(node);
        }
      }
    }
  });
  modalBodyObserver.observe(document.body, { childList: true });
}

/** @param {boolean} [visible] */
function showOptionsPanel(visible = true) {
  if (disposed) return;
  if (visible && !optionsPanelVisible) {
    focusBeforePanel = document.activeElement;
    optionsPanel.style.display = 'block';
    optionsPanel.setAttribute('aria-hidden', 'false');
    optionsPanelVisible = true;
    hideModalBackground();
    const first = getFocusablePanelElements()[0];
    (first ?? optionsPanel).focus();
  } else if (!visible && optionsPanelVisible) {
    optionsPanelVisible = false;
    optionsPanel.style.display = 'none';
    optionsPanel.setAttribute('aria-hidden', 'true');
    restoreModalBackground();
    if (
      focusBeforePanel instanceof HTMLElement &&
      document.documentElement.contains(focusBeforePanel)
    ) {
      focusBeforePanel.focus();
    }
    focusBeforePanel = null;
  }
}

const previousOptionsPanelDescriptor = Object.getOwnPropertyDescriptor(
  window,
  'ytaf_showOptionsPanel'
);
let ownsOptionsPanelGlobal = false;
try {
  window.ytaf_showOptionsPanel = showOptionsPanel;
  ownsOptionsPanelGlobal = window.ytaf_showOptionsPanel === showOptionsPanel;
} catch (error) {
  console.warn('[ui] Unable to expose the settings panel command', error);
}

/** @param {KeyboardEvent} event */
function handlePanelKeyDown(event) {
  if (getKeyColor(event) === 'green') return;
  const code = getEventCode(event);
  const focusable = getFocusablePanelElements();
  let handled = false;

  if (code in ARROW_KEY_CODE && typeof window.navigate === 'function') {
    const direction = ARROW_KEY_CODE[code];
    if (direction) window.navigate(direction);
    window.setTimeout(() => {
      if (
        optionsPanelVisible &&
        !optionsPanel.contains(document.activeElement)
      ) {
        (focusable[0] ?? optionsPanel).focus();
      }
    }, 0);
    handled = true;
  } else if (code === 9) {
    const active = document.activeElement;
    const currentIndex =
      active instanceof HTMLElement ? focusable.indexOf(active) : -1;
    const nextIndex =
      currentIndex < 0
        ? event.shiftKey
          ? focusable.length - 1
          : 0
        : (currentIndex + (event.shiftKey ? -1 : 1) + focusable.length) %
          focusable.length;
    const next = focusable[nextIndex];
    if (next) next.focus();
    handled = true;
  } else if (code === 13) {
    if (
      typeof KeyboardEvent !== 'undefined' &&
      event instanceof KeyboardEvent &&
      document.activeElement instanceof HTMLElement
    ) {
      document.activeElement.click();
    }
    handled = true;
  } else if (code === 27 || code === 461) {
    showOptionsPanel(false);
    handled = true;
  }

  if (handled) {
    event.preventDefault();
    event.stopPropagation();
  }
}

optionsPanel.addEventListener('keydown', handlePanelKeyDown, true);

/** @param {FocusEvent} event */
function trapPanelFocus(event) {
  if (
    !optionsPanelVisible ||
    optionsPanel.contains(/** @type {Node | null} */ (event.target))
  ) {
    return;
  }
  (getFocusablePanelElements()[0] ?? optionsPanel).focus();
  event.stopPropagation();
}

document.addEventListener('focusin', trapPanelFocus, true);

/** @param {HTMLElement} element */
function removeNotification(element) {
  const timers = notificationTimers.get(element) ?? [];
  for (const timer of timers) window.clearTimeout(timer);
  notificationTimers.delete(element);
  element.remove();
}

/** @param {string} text @param {number} time @param {string} color */
export function showNotification(text, time = 3000, color = 'grey') {
  if (disposed || !document.body) return;
  const duration = Number.isFinite(time) ? Math.max(0, time) : 3000;
  let container = document.querySelector('.ytaf-notification-container');
  if (!(container instanceof HTMLElement)) {
    container = document.createElement('div');
    container.className = 'ytaf-notification-container';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'false');
    document.body.appendChild(container);
  }

  while (container.children.length >= 5) {
    const oldest = container.firstElementChild;
    if (oldest instanceof HTMLElement) removeNotification(oldest);
    else oldest?.remove();
  }

  const element = document.createElement('div');
  const message = document.createElement('div');
  message.textContent = text;
  message.className = 'message message-hidden';
  message.style.borderColor = COLOR_MAP[color] || color;
  element.appendChild(message);
  container.appendChild(element);

  const revealTimer = window.setTimeout(() => {
    if (document.documentElement.contains(element)) {
      message.classList.remove('message-hidden');
    }
  }, 100);
  const hideTimer = window.setTimeout(
    () => {
      message.classList.add('message-hidden');
      const removeTimer = window.setTimeout(
        () => removeNotification(element),
        1_000
      );
      notificationTimers.get(element)?.push(removeTimer);
    },
    Math.max(100, duration)
  );
  notificationTimers.set(element, [revealTimer, hideTimer]);
}

function initHideLogo() {
  if (logoStyle) return;
  logoStyle = document.createElement('style');
  document.head.appendChild(logoStyle);
  /** @param {boolean} hide */
  const setHidden = (hide) => {
    if (logoStyle) {
      logoStyle.textContent = hide
        ? 'ytlr-redux-connect-ytlr-logo-entity { visibility: hidden; }'
        : '';
    }
  };
  setHidden(configRead('hideLogo'));
  configDisposers.push(
    configAddChangeListener('hideLogo', (event) => {
      setHidden(event.detail.newValue);
    })
  );
}

function removeQualityRootClass() {
  if (document.body?.classList.contains('app-quality-root')) {
    document.body.classList.remove('app-quality-root');
  }
}

function bindBodyFeatures() {
  const body = document.body;
  if (!body || body === observedBody) return;
  bodyClassObserver?.disconnect();
  observedBody = body;
  if (!body.contains(optionsPanel)) body.appendChild(optionsPanel);
  removeQualityRootClass();
  bodyClassObserver = new MutationObserver(removeQualityRootClass);
  bodyClassObserver.observe(body, {
    attributes: true,
    attributeFilter: ['class']
  });
  if (optionsPanelVisible) hideModalBackground();
}

/** @param {HTMLVideoElement} video */
function getPlayerRoot(video) {
  let parent = video.parentElement;
  while (parent) {
    if (parent.classList.contains('html5-video-player')) return parent;
    parent = parent.parentElement;
  }
  return null;
}

function getScreenHiddenVideo() {
  const selected = resolveActiveVideo();
  if (!audioOnlyEnabled || !audioOnlyVideo || selected === audioOnlyVideo) {
    return selected;
  }
  const currentConnected = document.documentElement.contains(audioOnlyVideo);
  if (currentConnected && audioOnlyVideo.ended !== true) {
    return audioOnlyVideo;
  }
  return selected;
}

/** @param {HTMLElement | null} playerRoot @param {string} selector */
function findAssociatedElement(playerRoot, selector) {
  const rooted = playerRoot?.querySelectorAll(selector);
  const candidates = rooted?.length
    ? rooted
    : document.querySelectorAll(selector);
  let selected = null;
  let selectedArea = -1;
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    if (!(candidate instanceof HTMLElement)) continue;
    const rect = candidate.getBoundingClientRect();
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    if (area >= selectedArea) {
      selected = candidate;
      selectedArea = area;
    }
  }
  return selected;
}

function restoreScreenHiddenStyles() {
  audioOnlyVideoStyles?.restore();
  audioOnlyVideoStyles = null;
  audioOnlyVideo = null;
  audioOnlyOverlayStyles?.restore();
  audioOnlyOverlayStyles = null;
  audioOnlyOverlay = null;
  screenHiddenMessage?.remove();
  screenHiddenMessage = null;
}

function applyScreenHiddenState() {
  if (!audioOnlyEnabled) {
    restoreScreenHiddenStyles();
    return true;
  }

  const nextVideo = getScreenHiddenVideo();
  const playerRoot = nextVideo ? getPlayerRoot(nextVideo) : null;
  const controls = findAssociatedElement(playerRoot, '[idomkey="controls"]');
  if (!nextVideo || !controls) return false;

  if (!screenHiddenMessage || screenHiddenMessage.parentElement !== controls) {
    screenHiddenMessage?.remove();
    screenHiddenMessage = document.createElement('div');
    screenHiddenMessage.textContent = 'Screen hidden - Press [BLUE] to toggle';
    screenHiddenMessage.className = YTAF_OVERLAY_CLASS;
    screenHiddenMessage.setAttribute('role', 'status');
    controls.insertBefore(screenHiddenMessage, controls.firstChild);
  }

  if (nextVideo !== audioOnlyVideo) {
    audioOnlyVideoStyles?.restore();
    audioOnlyVideo = nextVideo;
    audioOnlyVideoStyles = new InlineStyleOwner(nextVideo, ['visibility']);
  }

  const nextOverlay = findAssociatedElement(playerRoot, AUDIO_OVERLAY_SELECTOR);
  if (nextOverlay !== audioOnlyOverlay) {
    audioOnlyOverlayStyles?.restore();
    audioOnlyOverlay = nextOverlay;
    audioOnlyOverlayStyles = nextOverlay
      ? new InlineStyleOwner(nextOverlay, ['filter'])
      : null;
  }

  audioOnlyVideoStyles?.set('visibility', 'hidden');
  audioOnlyOverlayStyles?.set('filter', 'brightness(0)', 'important');
  return true;
}

function queueScreenHiddenState() {
  if (!audioOnlyEnabled || screenHiddenSyncToken !== null) return;
  screenHiddenSyncToken = window.setTimeout(() => {
    screenHiddenSyncToken = null;
    try {
      applyScreenHiddenState();
    } catch (error) {
      console.warn('[screen-hidden] Synchronization failed', error);
    }
  }, 50);
}

function stopScreenHiddenObserver() {
  unsubscribeScreenHiddenDOM?.();
  unsubscribeScreenHiddenDOM = null;
  if (screenHiddenSyncToken !== null) {
    window.clearTimeout(screenHiddenSyncToken);
    screenHiddenSyncToken = null;
  }
}

function toggleAudioOnly() {
  if (audioOnlyEnabled) {
    audioOnlyEnabled = false;
    stopScreenHiddenObserver();
    applyScreenHiddenState();
    showNotification('Screen hidden: Disabled', 2000, 'blue');
    return;
  }

  audioOnlyEnabled = true;
  try {
    unsubscribeScreenHiddenDOM = acquireTransactionalOwnership({
      apply: applyScreenHiddenState,
      subscribe: () =>
        subscribeDOMMutations(queueScreenHiddenState, { delayMs: 25 }),
      notify: () => showNotification('Screen hidden: Enabled', 2000, 'blue'),
      rollback: () => {
        audioOnlyEnabled = false;
        restoreScreenHiddenStyles();
      }
    });
  } catch (error) {
    audioOnlyEnabled = false;
    restoreScreenHiddenStyles();
    throw error;
  }
}

function queueAudioOnlyToggle() {
  const operation = audioOnlyToggleQueue.then(() => {
    if (disposed) return;
    toggleAudioOnly();
  });
  audioOnlyToggleQueue = operation.catch(() => undefined);
  return operation;
}

/** @param {KeyboardEvent} event */
function handleGlobalRemoteKey(event) {
  const color = getKeyColor(event);
  if (color !== 'green' && color !== 'blue') return true;
  event.preventDefault();
  event.stopPropagation();
  if (event.type !== 'keydown' || event.repeat) return false;

  if (color === 'green') showOptionsPanel(!optionsPanelVisible);
  else {
    void queueAudioOnlyToggle().catch((error) => {
      console.warn('[screen-hidden] Unable to toggle mode', error);
      showNotification('Screen-hidden mode unavailable', 2000, 'red');
    });
  }
  return false;
}

document.addEventListener('keydown', handleGlobalRemoteKey, true);
document.addEventListener('keypress', handleGlobalRemoteKey, true);
document.addEventListener('keyup', handleGlobalRemoteKey, true);

function initializeUIFixes() {
  if (disposed || initialized || !document.body) return;
  initialized = true;
  try {
    bindBodyFeatures();
    unsubscribeUIBodyDOM = subscribeDOMMutations(bindBodyFeatures, {
      delayMs: 50
    });
    initHideLogo();
    introNotificationTimer = window.setTimeout(() => {
      introNotificationTimer = null;
      showNotification(
        'Press [GREEN] to open YTAF configuration screen',
        2000,
        'green'
      );
    }, 0);
  } catch (error) {
    dispose();
    throw error;
  }
}

if (document.body) initializeUIFixes();
else {
  document.addEventListener('DOMContentLoaded', initializeUIFixes, {
    once: true
  });
}

export function dispose() {
  if (disposed) return;
  showOptionsPanel(false);
  disposed = true;
  optionsPanelVisible = false;
  restoreModalBackground();
  audioOnlyEnabled = false;
  stopScreenHiddenObserver();
  restoreScreenHiddenStyles();
  unsubscribeUIBodyDOM?.();
  unsubscribeUIBodyDOM = null;
  bodyClassObserver?.disconnect();
  bodyClassObserver = null;
  observedBody = null;
  if (introNotificationTimer !== null) {
    window.clearTimeout(introNotificationTimer);
    introNotificationTimer = null;
  }
  for (const element of notificationTimers.keys()) removeNotification(element);
  document.querySelector('.ytaf-notification-container')?.remove();
  for (const removeListener of configDisposers.splice(0)) removeListener();
  logoStyle?.remove();
  logoStyle = null;
  optionsPanel.remove();
  optionsPanel.removeEventListener('keydown', handlePanelKeyDown, true);
  document.removeEventListener('focusin', trapPanelFocus, true);
  document.removeEventListener('keydown', handleGlobalRemoteKey, true);
  document.removeEventListener('keypress', handleGlobalRemoteKey, true);
  document.removeEventListener('keyup', handleGlobalRemoteKey, true);
  document.removeEventListener('DOMContentLoaded', initializeUIFixes);
  if (
    ownsOptionsPanelGlobal &&
    window.ytaf_showOptionsPanel === showOptionsPanel
  ) {
    try {
      if (previousOptionsPanelDescriptor) {
        Object.defineProperty(
          window,
          'ytaf_showOptionsPanel',
          previousOptionsPanelDescriptor
        );
      } else {
        delete window.ytaf_showOptionsPanel;
      }
    } catch (error) {
      console.warn('[ui] Unable to restore settings panel command', error);
    }
  }
  restoreSpatialNavigation();
}
