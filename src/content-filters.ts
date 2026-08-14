import { configRead } from './config.js';
import {
  hasRemovableAds,
  hasRemovableBrowseFeatures,
  removeAdsFromResponse,
  removeBrowseFeaturesFromResponse,
  withInlinePlaybackNoAd
} from './core/json-transforms.js';
import {
  registerJSONParseTransformer,
  registerJSONStringifyTransformer
} from './hooks/json.ts';

function browseFilterOptions() {
  return {
    shorts: configRead('removeShorts'),
    endscreen: configRead('removeEndscreen')
  };
}

function hasApplicableResponseFilter(value: unknown) {
  if (configRead('enableAdBlock') && hasRemovableAds(value)) return true;
  const options = browseFilterOptions();
  return (
    (options.shorts || options.endscreen) &&
    hasRemovableBrowseFeatures(value, options)
  );
}

function filterResponse(value: unknown) {
  let filtered = value;
  if (configRead('enableAdBlock')) {
    filtered = removeAdsFromResponse(filtered);
  }
  const options = browseFilterOptions();
  if (options.shorts || options.endscreen) {
    filtered = removeBrowseFeaturesFromResponse(filtered, options);
  }
  return filtered;
}

let unregisterParse = () => false;
let unregisterStringify = () => false;
let installed = false;

export function installContentFilters() {
  if (installed) return;
  unregisterParse = registerJSONParseTransformer(
    'youtube-content-filters',
    filterResponse,
    () => true,
    hasApplicableResponseFilter
  );
  try {
    unregisterStringify = registerJSONStringifyTransformer(
      'youtube-adblock-request',
      withInlinePlaybackNoAd,
      () => configRead('enableAdBlock'),
      (serialized) =>
        serialized.includes('"playbackContext"') &&
        serialized.includes('"contentPlaybackContext"')
    );
    installed = true;
  } catch (error) {
    unregisterParse();
    throw error;
  }
}

export function dispose() {
  unregisterStringify();
  unregisterParse();
  unregisterStringify = () => false;
  unregisterParse = () => false;
  installed = false;
}
