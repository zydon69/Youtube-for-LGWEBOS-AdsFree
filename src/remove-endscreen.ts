import { configRead } from './config';
import { removeEndscreenFromResponse } from './core/json-transforms';
import { registerJSONParseTransformer } from './hooks/json';

registerJSONParseTransformer('endscreen', removeEndscreenFromResponse, () =>
  configRead('removeEndscreen')
);
