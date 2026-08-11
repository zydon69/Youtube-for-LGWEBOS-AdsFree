import { configRead } from './config';
import { removeShortsFromResponse } from './core/json-transforms';
import { registerJSONParseTransformer } from './hooks/json';

registerJSONParseTransformer('shorts', removeShortsFromResponse, () =>
  configRead('removeShorts')
);
