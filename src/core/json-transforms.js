/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value @param {string} key */
function getRecord(value, key) {
  return isRecord(value) && isRecord(value[key]) ? value[key] : null;
}

/** @param {Record<string, any> | null} sectionListRenderer */
function removeAdSlots(sectionListRenderer) {
  if (
    !isRecord(sectionListRenderer) ||
    !Array.isArray(sectionListRenderer.contents)
  ) {
    return;
  }

  sectionListRenderer.contents = sectionListRenderer.contents.filter(
    (entry) => !isRecord(entry) || !isRecord(entry.adSlotRenderer)
  );

  for (const entry of sectionListRenderer.contents) {
    const shelf = getRecord(entry, 'shelfRenderer');
    const content = getRecord(shelf, 'content');
    const horizontalList = getRecord(content, 'horizontalListRenderer');
    if (!horizontalList || !Array.isArray(horizontalList.items)) continue;

    horizontalList.items = horizontalList.items.filter(
      (item) => !isRecord(item) || !isRecord(item.adSlotRenderer)
    );
  }
}

/** @param {any} value */
export function removeAdsFromResponse(value) {
  if (!isRecord(value)) return value;

  if (Object.hasOwn(value, 'adPlacements')) delete value.adPlacements;
  if (Object.hasOwn(value, 'adSlots')) delete value.adSlots;
  if (Object.hasOwn(value, 'playerAds')) delete value.playerAds;

  const contents = getRecord(value, 'contents');
  const tvBrowse = getRecord(contents, 'tvBrowseRenderer');
  const tvBrowseContent = getRecord(tvBrowse, 'content');
  const surface = getRecord(tvBrowseContent, 'tvSurfaceContentRenderer');
  const surfaceContent = getRecord(surface, 'content');
  const homeSections = getRecord(surfaceContent, 'sectionListRenderer');

  if (homeSections && Array.isArray(homeSections.contents)) {
    homeSections.contents = homeSections.contents.filter(
      (entry) => !isRecord(entry) || !isRecord(entry.tvMastheadRenderer)
    );
    removeAdSlots(homeSections);
  }

  removeAdSlots(getRecord(contents, 'sectionListRenderer'));

  if (Array.isArray(value.entries)) {
    value.entries = value.entries.filter((entry) => {
      const command = getRecord(entry, 'command');
      const reel = getRecord(command, 'reelWatchEndpoint');
      const adParams = getRecord(reel, 'adClientParams');
      return adParams?.isAd !== true;
    });
  }

  return value;
}

/**
 * @param {any} root
 * @param {(record: Record<string, any>) => void} visitor
 */
function walkRecords(root, visitor) {
  if (!isRecord(root) && !Array.isArray(root)) return;

  const stack = [{ value: root, depth: 0 }];
  const visited = new Set();
  const MAX_VISITED_NODES = 50_000;
  const MAX_DEPTH = 100;

  while (stack.length > 0 && visited.size < MAX_VISITED_NODES) {
    const next = stack.pop();
    if (!next) break;
    const { value: current, depth } = next;
    if (
      (!isRecord(current) && !Array.isArray(current)) ||
      visited.has(current)
    ) {
      continue;
    }

    visited.add(current);
    if (isRecord(current)) visitor(current);

    if (depth >= MAX_DEPTH) continue;
    for (const child of Object.values(current)) {
      if (isRecord(child) || Array.isArray(child)) {
        stack.push({ value: child, depth: depth + 1 });
      }
    }
  }
}

/** @param {any} value */
export function removeShortsFromResponse(value) {
  walkRecords(value, (record) => {
    for (const key of ['gridRenderer', 'gridContinuation']) {
      const container = getRecord(record, key);
      if (!container || !Array.isArray(container.items)) continue;

      container.items = container.items.filter((item) => {
        const tile = getRecord(item, 'tileRenderer');
        const command = getRecord(tile, 'onSelectCommand');
        return !getRecord(command, 'reelWatchEndpoint');
      });
    }

    const sectionList = getRecord(record, 'sectionListRenderer');
    if (!sectionList || !Array.isArray(sectionList.contents)) return;

    sectionList.contents = sectionList.contents.filter((item) => {
      const shelf = getRecord(item, 'shelfRenderer');
      return (
        shelf?.tvhtml5ShelfRendererType !== 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS'
      );
    });
  });

  return value;
}

/** @param {any} value */
export function removeEndscreenFromResponse(value) {
  walkRecords(value, (record) => {
    const endscreen = getRecord(record, 'endscreen');
    if (endscreen && isRecord(endscreen.endscreenRenderer)) {
      delete record.endscreen;
    }
  });

  return value;
}

/** @param {any} value */
export function withInlinePlaybackNoAd(value) {
  if (!isRecord(value)) return value;

  const playbackContext = getRecord(value, 'playbackContext');
  const contentPlaybackContext = getRecord(
    playbackContext,
    'contentPlaybackContext'
  );
  if (!playbackContext || !contentPlaybackContext) return value;

  return {
    ...value,
    playbackContext: {
      ...playbackContext,
      contentPlaybackContext: {
        ...contentPlaybackContext,
        isInlinePlaybackNoAd: true
      }
    }
  };
}
