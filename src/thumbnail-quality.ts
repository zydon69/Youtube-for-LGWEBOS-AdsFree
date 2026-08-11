const webpTestImgs = {
  lossy: 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA',
  lossless: 'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==',
  alpha:
    'UklGRkoAAABXRUJQVlA4WAoAAAAQAAAAAAAAAAAAQUxQSAwAAAARBxAR/Q9ERP8DAABWUDggGAAAABQBAJ0BKgEAAQAAAP4AAA3AAP7mtQAAAA==',
  animation:
    'UklGRlIAAABXRUJQVlA4WAoAAAASAAAAAAAAAAAAQU5JTQYAAAD/////AABBTk1GJgAAAAAAAAAAAAAAAAAAAGQAAABWUDhMDQAAAC8AAAAQBxAREYiI/gcA'
} as const;

function checkWebpFeature(
  feature: keyof typeof webpTestImgs,
  callback: (
    featureName: keyof typeof webpTestImgs,
    isSupported: boolean
  ) => void
) {
  const img = new Image();
  img.onload = function () {
    const result = img.width > 0 && img.height > 0;
    callback(feature, result);
  };

  img.onerror = function () {
    callback(feature, false);
  };

  img.src = 'data:image/webp;base64,' + webpTestImgs[feature];
}

let webpSupported = false;
checkWebpFeature('lossy', (_, support) => {
  webpSupported = support;
});

function rewriteURL(url: URL) {
  const YT_THUMBNAIL_PATHNAME_REGEX =
    /vi(?:_webp)?(\/.*?\/)([a-z0-9]+?)(_\w*?)?\.[a-z]+$/g;

  const YT_TARGET_THUMBNAIL_NAMES = [
    'sddefault',
    'hqdefault',
    'mqdefault',
    'default'
  ] as const;

  if (url.protocol !== 'https:' || url.hostname !== 'i.ytimg.com') return null;

  const isABTest = url.hostname.match(/^i\d/) !== null;
  // Don't know how to handle A/B test thumbnails so we don't upgrade them.
  if (isABTest) return null;

  const replacementPathname = url.pathname.replace(
    YT_THUMBNAIL_PATHNAME_REGEX,
    (match, p1, p2, p3) => {
      if (!YT_TARGET_THUMBNAIL_NAMES.includes(p2)) return match; // Only rewrite regular thumbnail URLs. Not shorts, etc.
      return `${webpSupported ? 'vi_webp' : 'vi'}${p1}sddefault${p3 ?? ''}.${webpSupported ? 'webp' : 'jpg'}`;
    }
  );
  if (url.pathname === replacementPathname)
    // pathname not changed because not a regular thumbnail or already upgraded.
    return null;

  url = new URL(url);

  url.pathname = replacementPathname;
  return url;
}

function parseCSSUrl(value: string): URL | undefined {
  try {
    return new URL(value.slice(4, -1).replace(/["']/g, ''));
  } catch (e) {
    return undefined; // Not a valid URL
  }
}

function upgradeBgImg(element: HTMLElement) {
  const style = element.style;
  const old = parseCSSUrl(style.backgroundImage);
  if (!old) return;

  const target = rewriteURL(old);
  if (!target) return;

  const lazyLoader = new Image();

  lazyLoader.onload = () => {
    // Don't swap if a placeholder thumbnail was provided.
    // Placeholder thumbnails are the same size as the "default" size.
    if (lazyLoader.naturalHeight === 90) return;

    const curr = parseCSSUrl(style.backgroundImage);
    if (!curr) return;

    // Don't swap out element image if it has been changed while target image was loading.
    if (curr.href !== old.href) return;

    style.backgroundImage = `url(${target.href})`;
  };

  lazyLoader.src = target.href;
}

const YT_THUMBNAIL_ELEMENT_TAG = 'ytlr-thumbnail-details';
let observedThumbnails = new WeakSet<HTMLElement>();
const styleObserver = new MutationObserver((mutations) => {
  const dummy = document.createElement('div');
  for (const mutation of mutations) {
    if (!(mutation.target instanceof HTMLElement)) continue;
    dummy.style.cssText = mutation.oldValue ?? '';
    if (
      mutation.target.style.backgroundImage &&
      mutation.target.style.backgroundImage !== dummy.style.backgroundImage
    ) {
      upgradeBgImg(mutation.target);
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
  if (element.style.backgroundImage) upgradeBgImg(element);
}

function observeThumbnailTree(root: HTMLElement) {
  if (root.matches(YT_THUMBNAIL_ELEMENT_TAG)) observeThumbnail(root);
  root
    .querySelectorAll<HTMLElement>(YT_THUMBNAIL_ELEMENT_TAG)
    .forEach(observeThumbnail);
}

const documentObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node instanceof HTMLElement) observeThumbnailTree(node);
    }
  }
});

function enableObserver() {
  if (!document.body) return;
  observeThumbnailTree(document.body);
  documentObserver.observe(document.body, { subtree: true, childList: true });
}

function disableObserver() {
  documentObserver.disconnect();
  styleObserver.disconnect();
  observedThumbnails = new WeakSet();
}

import { configRead, configAddChangeListener } from './config';

function initializeThumbnailObserver() {
  if (configRead('upgradeThumbnails')) enableObserver();
}

if (document.body) initializeThumbnailObserver();
else {
  document.addEventListener('DOMContentLoaded', initializeThumbnailObserver, {
    once: true
  });
}

configAddChangeListener('upgradeThumbnails', (event) =>
  event.detail.newValue ? enableObserver() : disableObserver()
);
