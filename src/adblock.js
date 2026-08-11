import { configRead } from './config';
import {
  removeAdsFromResponse,
  withInlinePlaybackNoAd
} from './core/json-transforms';
import {
  registerJSONParseTransformer,
  registerJSONStringifyTransformer
} from './hooks/json';

registerJSONParseTransformer('adblock', removeAdsFromResponse, () =>
  configRead('enableAdBlock')
);

registerJSONStringifyTransformer('adblock', withInlinePlaybackNoAd, () =>
  configRead('enableAdBlock')
);
