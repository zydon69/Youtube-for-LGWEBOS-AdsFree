/*global __YTAF_VERSION__*/
import {
  disposeSpatialNavigationPolyfill,
  installSpatialNavigationPolyfill
} from './spatial-navigation-polyfill.js';
import { configAddChangeListener, configRead } from './config.js';
import './ui.css';
import {
  disposeNotifications,
  showNotification
} from './core/notifications.js';
export { showNotification } from './core/notifications.js';
import { resolveActiveVideo } from './core/active-media-resolver.ts';
import {
  acquireTransactionalOwnership,
  InlineStyleOwner
} from './core/inline-style-owner.js';
import { subscribeDOMMutations } from './core/dom-mutations.js';
import { createSettingsPanel } from './core/settings-panel.js';

/** @type {{ keyMode: string } | null} */
let spatialNavigation = null;
/** @type {string | undefined} */
let previousSpatialKeyModeValue;
/** @type {PropertyDescriptor | undefined} */
let previousSpatialKeyModeDescriptor;
let ownsSpatialKeyMode = false;

function configureSpatialNavigation() {
  spatialNavigation = window.__spatialNavigation__ ?? null;
  if (spatialNavigation) {
    previousSpatialKeyModeValue = spatialNavigation.keyMode;
    previousSpatialKeyModeDescriptor = Object.getOwnPropertyDescriptor(
      spatialNavigation,
      'keyMode'
    );
    spatialNavigation.keyMode = 'NONE';
    ownsSpatialKeyMode = spatialNavigation.keyMode === 'NONE';
  }
}

function restoreSpatialNavigation() {
  if (
    !ownsSpatialKeyMode ||
    !spatialNavigation ||
    spatialNavigation.keyMode !== 'NONE'
  ) {
    spatialNavigation = null;
    return;
  }
  try {
    if (previousSpatialKeyModeDescriptor) {
      Reflect.set(spatialNavigation, 'keyMode', previousSpatialKeyModeValue);
      Object.defineProperty(
        spatialNavigation,
        'keyMode',
        previousSpatialKeyModeDescriptor
      );
    } else Reflect.deleteProperty(spatialNavigation, 'keyMode');
    ownsSpatialKeyMode = false;
  } catch (error) {
    console.warn('[ui] Unable to restore spatial navigation', error);
  } finally {
    spatialNavigation = null;
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
const AUDIO_OVERLAY_SELECTOR = '.ytLrAudioPlayerOverlayAudioMode';
const YTAF_OVERLAY_CLASS = 'ytaf-ui-watchControl-overlayMessage';

/** @type {Array<() => void>} */
const configDisposers = [];
/** @type {Map<Element, string | null>} */
const backgroundAriaState = new Map();

let disposed = true;
let installed = false;
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
/** @type {Set<HTMLElement>} */
const qualityRootClassOwners = new Set();
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
  const code = getEventCode(event);
  if (code === 191) {
    let target = event.target instanceof Element ? event.target : null;
    while (target) {
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.getAttribute('contenteditable') === 'true'
      ) {
        return null;
      }
      target = target.parentElement;
    }
  }
  return colorCodeMap.get(code) ?? null;
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

/** @type {HTMLElement} */
let optionsPanel = document.createElement('div');
/** @type {{ element: HTMLElement, dispose: () => void } | null} */
let settingsPanel = null;

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

/** @type {PropertyDescriptor | undefined} */
let previousOptionsPanelDescriptor;
let ownsOptionsPanelGlobal = false;

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
    qualityRootClassOwners.add(document.body);
    document.body.classList.remove('app-quality-root');
  }
}

function restoreQualityRootClasses() {
  for (const body of qualityRootClassOwners) {
    body.classList.add('app-quality-root');
  }
  qualityRootClassOwners.clear();
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
  if (!selected) {
    return currentConnected && audioOnlyVideo.ended !== true
      ? audioOnlyVideo
      : null;
  }
  const selectedRect = selected.getBoundingClientRect();
  const currentRect = audioOnlyVideo.getBoundingClientRect();
  const selectedArea = Math.max(0, selectedRect.width * selectedRect.height);
  const currentArea = Math.max(0, currentRect.width * currentRect.height);
  const selectedIsActive =
    selected.paused === false || selectedArea > currentArea;
  if (currentConnected && audioOnlyVideo.ended !== true && !selectedIsActive) {
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
  let initiallyApplied = false;
  try {
    unsubscribeScreenHiddenDOM = acquireTransactionalOwnership({
      apply: () => {
        initiallyApplied = applyScreenHiddenState();
        // The player is created asynchronously during startup and SPA
        // navigation. Owning the observer is a valid pending state: it applies
        // the mode as soon as the associated video and controls exist.
        return true;
      },
      subscribe: () =>
        subscribeDOMMutations(queueScreenHiddenState, { delayMs: 25 }),
      notify: () =>
        showNotification(
          initiallyApplied
            ? 'Screen hidden: Enabled'
            : 'Screen hidden: Waiting for player',
          2000,
          'blue'
        ),
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

export function installUI() {
  if (installed) return;
  installed = true;
  disposed = false;
  try {
    installSpatialNavigationPolyfill();
    configureSpatialNavigation();
    settingsPanel = createSettingsPanel();
    optionsPanel = settingsPanel.element;
    previousOptionsPanelDescriptor = Object.getOwnPropertyDescriptor(
      window,
      'ytaf_showOptionsPanel'
    );
    window.ytaf_showOptionsPanel = showOptionsPanel;
    ownsOptionsPanelGlobal = window.ytaf_showOptionsPanel === showOptionsPanel;
    optionsPanel.addEventListener('keydown', handlePanelKeyDown, true);
    document.addEventListener('focusin', trapPanelFocus, true);
    document.addEventListener('keydown', handleGlobalRemoteKey, true);
    document.addEventListener('keypress', handleGlobalRemoteKey, true);
    document.addEventListener('keyup', handleGlobalRemoteKey, true);
    if (document.body) initializeUIFixes();
    else {
      document.addEventListener('DOMContentLoaded', initializeUIFixes, {
        once: true
      });
    }
  } catch (error) {
    dispose();
    throw error;
  }
}

export function dispose() {
  if (!installed) return;
  installed = false;
  showOptionsPanel(false);
  disposed = true;
  initialized = false;
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
  restoreQualityRootClasses();
  if (introNotificationTimer !== null) {
    window.clearTimeout(introNotificationTimer);
    introNotificationTimer = null;
  }
  disposeNotifications();
  for (const removeListener of configDisposers.splice(0)) removeListener();
  settingsPanel?.dispose();
  settingsPanel = null;
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
  ownsOptionsPanelGlobal = false;
  previousOptionsPanelDescriptor = undefined;
  restoreSpatialNavigation();
  disposeSpatialNavigationPolyfill();
}
