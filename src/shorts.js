import { configRead } from './config';
import { removeShortsFromResponse } from './core/json-transforms';
import { registerJSONParseTransformer } from './hooks/json';

registerJSONParseTransformer('shorts', (value) =>
  configRead('removeShorts') ? removeShortsFromResponse(value) : value
);
