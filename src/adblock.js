import { configRead } from './config';
import {
  hasRemovableAds,
  removeAdsFromResponse,
  withInlinePlaybackNoAd
} from './core/json-transforms';
import {
  registerJSONParseTransformer,
  registerJSONStringifyTransformer
} from './hooks/json';

let unregisterParseTransformer = () => false;
let unregisterStringifyTransformer = () => false;

try {
  unregisterParseTransformer = registerJSONParseTransformer(
    'adblock',
    removeAdsFromResponse,
    () => configRead('enableAdBlock'),
    hasRemovableAds
  );
  unregisterStringifyTransformer = registerJSONStringifyTransformer(
    'adblock',
    withInlinePlaybackNoAd,
    () => configRead('enableAdBlock'),
    (serialized) =>
      serialized.includes('"playbackContext"') &&
      serialized.includes('"contentPlaybackContext"')
  );
} catch (error) {
  unregisterStringifyTransformer();
  unregisterParseTransformer();
  throw error;
}

export function dispose() {
  unregisterStringifyTransformer();
  unregisterParseTransformer();
}
