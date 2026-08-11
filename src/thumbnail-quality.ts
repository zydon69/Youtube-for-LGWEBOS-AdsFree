import { configRead, configAddChangeListener } from './config.js';
import { subscribeDOMMutations } from './core/dom-mutations.js';

const WEBP_LOSSY_TEST_IMAGE =
  'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
const WEBP_DETECTION_TIMEOUT_MS = 1_500;
const MAX_CONCURRENT_THUMBNAIL_LOADS = 4;
const MAX_PENDING_THUMBNAIL_LOADS = 256;
const THUMBNAIL_LOAD_TIMEOUT_MS = 8_000;
const YT_THUMBNAIL_ELEMENT_TAG = 'YTLR-THUMBNAIL-DETAILS';

interface UpgradeRequest {
  readonly generation: number;
  readonly sourceHref: string;
  readonly targetHref: string;
}

interface ActiveUpgrade {
  readonly image: HTMLImageElement;
  readonly request: UpgradeRequest;
  timeoutToken: number | null;
}

interface RestorableBackground {
  originalValue: string;
  originalPriority: string;
  appliedValue: string;
}

let webpSupported = false;
let webpDetectionComplete = false;
let observerEnabled = false;
let thumbnailGeneration = 0;
let unsubscribeDocument: (() => void) | null = null;
let observedThumbnails = new WeakSet<HTMLElement>();
let activeLoadCount = 0;
let webpProbeImage: HTMLImageElement | null = null;
let webpDetectionToken: number | null = null;

const pendingUpgrades = new Map<HTMLElement, UpgradeRequest>();
const activeUpgrades = new Map<HTMLElement, ActiveUpgrade>();
const upgradedBackgrounds = new Map<HTMLElement, RestorableBackground>();

function isConnected(element: HTMLElement) {
  const root = element.ownerDocument?.documentElement;
  return root ? root.contains(element) : false;
}

function isThumbnailElement(element: HTMLElement) {
  return element.tagName.toUpperCase() === YT_THUMBNAIL_ELEMENT_TAG;
}

function beginWebpDetection() {
  let completed = false;
  let image: HTMLImageElement | null = null;

  const finish = (supported: boolean) => {
    if (completed) return;
    completed = true;
    if (webpDetectionToken !== null) {
      window.clearTimeout(webpDetectionToken);
      webpDetectionToken = null;
    }
    if (image) {
      image.onload = null;
      image.onerror = null;
    }
    webpProbeImage = null;
    webpSupported = supported;
    webpDetectionComplete = true;
    if (observerEnabled) {
      const root = document.body ?? document.documentElement;
      if (root instanceof HTMLElement) observeThumbnailTree(root);
    }
  };

  try {
    image = new Image();
    webpProbeImage = image;
    image.onload = () =>
      finish(Boolean(image && image.width > 0 && image.height > 0));
    image.onerror = () => finish(false);
    webpDetectionToken = window.setTimeout(
      () => finish(false),
      WEBP_DETECTION_TIMEOUT_MS
    );
    image.src = `data:image/webp;base64,${WEBP_LOSSY_TEST_IMAGE}`;
  } catch {
    finish(false);
  }
}

/**
 * Return an upgraded YouTube thumbnail URL without mutating the input.
 * @param {URL} input
 * @param {boolean} supportsWebp
 */
export function rewriteThumbnailURL(input: URL, supportsWebp: boolean) {
  if (input.protocol !== 'https:' || input.hostname !== 'i.ytimg.com') {
    return null;
  }

  const match = input.pathname.match(
    /^\/vi(?:_webp)?(\/[^/]+\/)(?:sddefault|hqdefault|mqdefault|default)(_[\w-]+)?\.[a-z0-9]+$/i
  );
  if (!match) return null;
  const suffix = match[2] ?? '';
  const formatPath = supportsWebp ? 'vi_webp' : 'vi';
  const extension = supportsWebp ? 'webp' : 'jpg';
  const pathname = `/${formatPath}${match[1]}sddefault${suffix}.${extension}`;
  if (pathname === input.pathname) return null;

  const result = new URL(input.href);
  result.pathname = pathname;
  return result;
}

function parseCSSUrl(value: string): URL | null {
  const trimmed = value.trim();
  if (trimmed.length < 6 || trimmed.slice(0, 4).toLowerCase() !== 'url(') {
    return null;
  }
  if (trimmed.charAt(trimmed.length - 1) !== ')') return null;
  let raw = trimmed.slice(4, -1).trim();
  const first = raw.charAt(0);
  if (first === '"' || first === "'") {
    if (raw.charAt(raw.length - 1) !== first) return null;
    raw = raw.slice(1, -1);
  }
  if (!raw) return null;
  try {
    return new URL(raw.trim(), document.baseURI);
  } catch {
    return null;
  }
}

function cancelUpgrade(element: HTMLElement) {
  pendingUpgrades.delete(element);
  const active = activeUpgrades.get(element);
  if (!active) return;
  active.image.onload = null;
  active.image.onerror = null;
  if (active.timeoutToken !== null) {
    window.clearTimeout(active.timeoutToken);
    active.timeoutToken = null;
  }
  activeUpgrades.delete(element);
  activeLoadCount = Math.max(0, activeLoadCount - 1);
}

function restoreBackground(element: HTMLElement) {
  const state = upgradedBackgrounds.get(element);
  if (!state) return;
  if (element.style.backgroundImage === state.appliedValue) {
    if (state.originalValue) {
      element.style.setProperty(
        'background-image',
        state.originalValue,
        state.originalPriority
      );
    } else {
      element.style.removeProperty('background-image');
    }
  }
  upgradedBackgrounds.delete(element);
}

function applyCompletedUpgrade(
  element: HTMLElement,
  request: UpgradeRequest,
  image: HTMLImageElement
) {
  if (
    !observerEnabled ||
    request.generation !== thumbnailGeneration ||
    !isConnected(element) ||
    image.naturalHeight === 90
  ) {
    return;
  }
  const current = parseCSSUrl(element.style.backgroundImage);
  if (!current || current.href !== request.sourceHref) return;

  const prior = upgradedBackgrounds.get(element);
  if (!prior || element.style.backgroundImage !== prior.appliedValue) {
    upgradedBackgrounds.set(element, {
      originalValue: element.style.getPropertyValue('background-image'),
      originalPriority: element.style.getPropertyPriority('background-image'),
      appliedValue: ''
    });
  }

  element.style.setProperty('background-image', `url("${request.targetHref}")`);
  const state = upgradedBackgrounds.get(element);
  if (state) state.appliedValue = element.style.backgroundImage;
}

function finishUpgrade(
  element: HTMLElement,
  active: ActiveUpgrade,
  succeeded: boolean
) {
  if (activeUpgrades.get(element) !== active) return;
  active.image.onload = null;
  active.image.onerror = null;
  if (active.timeoutToken !== null) {
    window.clearTimeout(active.timeoutToken);
    active.timeoutToken = null;
  }
  activeUpgrades.delete(element);
  activeLoadCount = Math.max(0, activeLoadCount - 1);
  if (succeeded) {
    applyCompletedUpgrade(element, active.request, active.image);
  }
  pumpUpgradeQueue();
}

function pumpUpgradeQueue() {
  if (!observerEnabled || !webpDetectionComplete) return;
  while (
    activeLoadCount < MAX_CONCURRENT_THUMBNAIL_LOADS &&
    pendingUpgrades.size > 0
  ) {
    const first = pendingUpgrades.entries().next().value as
      [HTMLElement, UpgradeRequest] | undefined;
    if (!first) return;
    const [element, request] = first;
    pendingUpgrades.delete(element);
    if (request.generation !== thumbnailGeneration || !isConnected(element)) {
      continue;
    }

    let image: HTMLImageElement;
    try {
      image = new Image();
    } catch {
      pendingUpgrades.clear();
      return;
    }
    const active: ActiveUpgrade = { image, request, timeoutToken: null };
    activeUpgrades.set(element, active);
    activeLoadCount++;
    image.onload = () => finishUpgrade(element, active, true);
    image.onerror = () => finishUpgrade(element, active, false);
    active.timeoutToken = window.setTimeout(
      () => finishUpgrade(element, active, false),
      THUMBNAIL_LOAD_TIMEOUT_MS
    );
    try {
      image.src = request.targetHref;
    } catch {
      finishUpgrade(element, active, false);
    }
  }
}

function queueUpgrade(element: HTMLElement) {
  if (!observerEnabled || !webpDetectionComplete || !isConnected(element)) {
    return;
  }
  const source = parseCSSUrl(element.style.backgroundImage);
  if (!source) return;
  const target = rewriteThumbnailURL(source, webpSupported);
  if (!target) return;

  const request = {
    generation: thumbnailGeneration,
    sourceHref: source.href,
    targetHref: target.href
  };
  const active = activeUpgrades.get(element);
  if (
    active?.request.generation === request.generation &&
    active.request.sourceHref === request.sourceHref &&
    active.request.targetHref === request.targetHref
  ) {
    return;
  }

  cancelUpgrade(element);
  if (pendingUpgrades.size >= MAX_PENDING_THUMBNAIL_LOADS) {
    const oldest = pendingUpgrades.keys().next().value as
      HTMLElement | undefined;
    if (oldest) pendingUpgrades.delete(oldest);
  }
  pendingUpgrades.set(element, request);
  pumpUpgradeQueue();
}

const styleObserver = new MutationObserver((mutations) => {
  const dummy = document.createElement('div');
  for (const mutation of mutations) {
    if (!(mutation.target instanceof HTMLElement)) continue;
    dummy.style.cssText = mutation.oldValue ?? '';
    if (
      mutation.target.style.backgroundImage &&
      mutation.target.style.backgroundImage !== dummy.style.backgroundImage
    ) {
      queueUpgrade(mutation.target);
    }
  }
});

function observeThumbnail(element: HTMLElement) {
  if (observedThumbnails.has(element)) return;
  observedThumbnails.add(element);
  styleObserver.observe(element, {
    attributes: true,
    attributeFilter: ['style'],
    attributeOldValue: true
  });
  if (element.style.backgroundImage) queueUpgrade(element);
}

function observeThumbnailTree(root: HTMLElement) {
  if (isThumbnailElement(root)) observeThumbnail(root);
  const descendants = root.querySelectorAll<HTMLElement>(
    'ytlr-thumbnail-details'
  );
  for (let index = 0; index < descendants.length; index++) {
    const descendant = descendants[index];
    if (descendant) observeThumbnail(descendant);
  }
}

function cleanupDisconnectedElements() {
  for (const element of pendingUpgrades.keys()) {
    if (!isConnected(element)) pendingUpgrades.delete(element);
  }
  for (const element of activeUpgrades.keys()) {
    if (!isConnected(element)) cancelUpgrade(element);
  }
  for (const element of upgradedBackgrounds.keys()) {
    if (!isConnected(element)) restoreBackground(element);
  }
  pumpUpgradeQueue();
}

function handleDocumentMutations(
  mutations: MutationRecord[],
  metadata: { overflowed: boolean }
) {
  if (metadata.overflowed) {
    const root = document.body ?? document.documentElement;
    if (root instanceof HTMLElement) observeThumbnailTree(root);
  } else {
    for (const mutation of mutations) {
      for (let index = 0; index < mutation.addedNodes.length; index++) {
        const node = mutation.addedNodes[index];
        if (node instanceof HTMLElement) observeThumbnailTree(node);
      }
    }
  }
  cleanupDisconnectedElements();
}

function enableObserver() {
  observerEnabled = true;
  if (unsubscribeDocument || !document.documentElement) return;
  thumbnailGeneration++;
  try {
    const root = document.body ?? document.documentElement;
    if (root instanceof HTMLElement && webpDetectionComplete) {
      observeThumbnailTree(root);
    }
    unsubscribeDocument = subscribeDOMMutations(handleDocumentMutations, {
      delayMs: 25,
      maxPendingRecords: 128
    });
  } catch (error) {
    disableObserver();
    throw error;
  }
}

function disableObserver() {
  if (!observerEnabled && !unsubscribeDocument) return;
  observerEnabled = false;
  thumbnailGeneration++;
  unsubscribeDocument?.();
  unsubscribeDocument = null;
  styleObserver.disconnect();
  observedThumbnails = new WeakSet();
  for (const element of pendingUpgrades.keys()) cancelUpgrade(element);
  for (const element of activeUpgrades.keys()) cancelUpgrade(element);
  pendingUpgrades.clear();
  activeUpgrades.clear();
  activeLoadCount = 0;
  for (const element of upgradedBackgrounds.keys()) restoreBackground(element);
  upgradedBackgrounds.clear();
}

function initializeThumbnailObserver() {
  if (configRead('upgradeThumbnails')) enableObserver();
}

function handleThumbnailConfigChange(
  event: CustomEvent<{ newValue: boolean }>
) {
  if (event.detail.newValue) enableObserver();
  else disableObserver();
}

let removeThumbnailConfigListener: () => void = () => {};

try {
  beginWebpDetection();
  removeThumbnailConfigListener = configAddChangeListener(
    'upgradeThumbnails',
    handleThumbnailConfigChange
  );
  if (document.body) initializeThumbnailObserver();
  else {
    document.addEventListener('DOMContentLoaded', initializeThumbnailObserver, {
      once: true
    });
  }
} catch (error) {
  dispose();
  throw error;
}

export function dispose() {
  disableObserver();
  if (webpDetectionToken !== null) {
    window.clearTimeout(webpDetectionToken);
    webpDetectionToken = null;
  }
  if (webpProbeImage) {
    webpProbeImage.onload = null;
    webpProbeImage.onerror = null;
    webpProbeImage = null;
  }
  removeThumbnailConfigListener();
  document.removeEventListener('DOMContentLoaded', initializeThumbnailObserver);
}
