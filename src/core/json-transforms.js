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

/** @param {Record<string, any> | null} sectionListRenderer */
function sectionListHasAds(sectionListRenderer) {
  if (
    !isRecord(sectionListRenderer) ||
    !Array.isArray(sectionListRenderer.contents)
  ) {
    return false;
  }
  for (const entry of sectionListRenderer.contents) {
    if (isRecord(entry) && isRecord(entry.adSlotRenderer)) return true;
    const shelf = getRecord(entry, 'shelfRenderer');
    const content = getRecord(shelf, 'content');
    const horizontalList = getRecord(content, 'horizontalListRenderer');
    if (!horizontalList || !Array.isArray(horizontalList.items)) continue;
    for (const item of horizontalList.items) {
      if (isRecord(item) && isRecord(item.adSlotRenderer)) return true;
    }
  }
  return false;
}

/**
 * Cheap applicability guard used before allocating a transactional clone.
 * @param {unknown} value
 */
export function hasRemovableAds(value) {
  if (!isRecord(value)) return false;
  if (
    Object.hasOwn(value, 'adPlacements') ||
    Object.hasOwn(value, 'adSlots') ||
    Object.hasOwn(value, 'playerAds')
  ) {
    return true;
  }

  const contents = getRecord(value, 'contents');
  const tvBrowse = getRecord(contents, 'tvBrowseRenderer');
  const tvBrowseContent = getRecord(tvBrowse, 'content');
  const surface = getRecord(tvBrowseContent, 'tvSurfaceContentRenderer');
  const surfaceContent = getRecord(surface, 'content');
  const homeSections = getRecord(surfaceContent, 'sectionListRenderer');
  if (homeSections && Array.isArray(homeSections.contents)) {
    for (const entry of homeSections.contents) {
      if (isRecord(entry) && isRecord(entry.tvMastheadRenderer)) return true;
    }
  }
  if (
    sectionListHasAds(homeSections) ||
    sectionListHasAds(getRecord(contents, 'sectionListRenderer'))
  ) {
    return true;
  }

  if (!Array.isArray(value.entries)) return false;
  for (const entry of value.entries) {
    const command = getRecord(entry, 'command');
    const reel = getRecord(command, 'reelWatchEndpoint');
    const adParams = getRecord(reel, 'adClientParams');
    if (adParams?.isAd === true) return true;
  }
  return false;
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
 * @param {(record: Record<string, any>) => boolean} visitor
 */
function someRecord(root, visitor) {
  if (!isRecord(root) && !Array.isArray(root)) return false;

  const stack = [root];
  const visited = new Set();

  // JSON.parse has already paid the allocation cost for every node. Walking
  // the complete graph iteratively avoids both recursive stack exhaustion and
  // the former silent 50k/depth cut-off that left matching payloads untouched.
  // `visited` also keeps direct callers safe when they pass cyclic objects.
  while (stack.length > 0) {
    const current = stack.pop();
    if (
      (!isRecord(current) && !Array.isArray(current)) ||
      visited.has(current)
    ) {
      continue;
    }

    visited.add(current);
    if (isRecord(current) && visitor(current)) return true;

    for (const child of Object.values(current)) {
      if (isRecord(child) || Array.isArray(child)) {
        stack.push(child);
      }
    }
  }
  return false;
}

/**
 * @param {any} root
 * @param {(record: Record<string, any>) => void} visitor
 */
function walkRecords(root, visitor) {
  someRecord(root, (record) => {
    visitor(record);
    return false;
  });
}

/** @param {unknown} value */
export function hasRemovableShorts(value) {
  return someRecord(value, (record) => {
    for (const key of ['gridRenderer', 'gridContinuation']) {
      const container = getRecord(record, key);
      if (!container || !Array.isArray(container.items)) continue;
      for (const item of container.items) {
        const tile = getRecord(item, 'tileRenderer');
        const command = getRecord(tile, 'onSelectCommand');
        if (getRecord(command, 'reelWatchEndpoint')) return true;
      }
    }

    const sectionList = getRecord(record, 'sectionListRenderer');
    if (!sectionList || !Array.isArray(sectionList.contents)) return false;
    for (const item of sectionList.contents) {
      const shelf = getRecord(item, 'shelfRenderer');
      if (
        shelf?.tvhtml5ShelfRendererType === 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS'
      ) {
        return true;
      }
    }
    return false;
  });
}

/** @param {unknown} value */
export function hasRemovableEndscreen(value) {
  return someRecord(value, (record) => {
    const endscreen = getRecord(record, 'endscreen');
    return Boolean(endscreen && isRecord(endscreen.endscreenRenderer));
  });
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
