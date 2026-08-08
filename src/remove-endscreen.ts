import { configRead } from './config';
import { removeEndscreenFromResponse } from './core/json-transforms';
import { registerJSONParseTransformer } from './hooks/json';

registerJSONParseTransformer('endscreen', (value) =>
  configRead('removeEndscreen') ? removeEndscreenFromResponse(value) : value
);
