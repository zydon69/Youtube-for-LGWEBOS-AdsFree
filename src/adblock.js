import { configRead } from './config';
import { removeAdsFromResponse } from './core/json-transforms';
import { registerJSONParseTransformer } from './hooks/json';

registerJSONParseTransformer('adblock', (value) =>
  configRead('enableAdBlock') ? removeAdsFromResponse(value) : value
);
