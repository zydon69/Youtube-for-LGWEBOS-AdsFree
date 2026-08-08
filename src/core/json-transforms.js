function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getRecord(value, key) {
  return isRecord(value) && isRecord(value[key]) ? value[key] : null;
}

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

export function removeAdsFromResponse(value) {
  if (!isRecord(value)) return value;

  if (value.adPlacements) delete value.adPlacements;
  if (Array.isArray(value.adSlots)) delete value.adSlots;
  if (value.playerAds) delete value.playerAds;

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

function walkRecords(root, visitor) {
  if (!isRecord(root) && !Array.isArray(root)) return;

  const stack = [root];
  const visited = new Set();

  while (stack.length > 0) {
    const current = stack.pop();
    if (
      (!isRecord(current) && !Array.isArray(current)) ||
      visited.has(current)
    ) {
      continue;
    }

    visited.add(current);
    if (isRecord(current)) visitor(current);

    for (const child of Object.values(current)) {
      if (isRecord(child) || Array.isArray(child)) stack.push(child);
    }
  }
}

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

export function removeEndscreenFromResponse(value) {
  walkRecords(value, (record) => {
    const endscreen = getRecord(record, 'endscreen');
    if (endscreen && isRecord(endscreen.endscreenRenderer)) {
      delete record.endscreen;
    }
  });

  return value;
}

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
