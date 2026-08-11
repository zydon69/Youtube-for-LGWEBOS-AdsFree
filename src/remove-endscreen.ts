import { configRead } from './config';
import {
  hasRemovableEndscreen,
  removeEndscreenFromResponse
} from './core/json-transforms';
import { registerJSONParseTransformer } from './hooks/json';

const unregisterTransformer = registerJSONParseTransformer(
  'endscreen',
  removeEndscreenFromResponse,
  () => configRead('removeEndscreen'),
  hasRemovableEndscreen
);

export function dispose() {
  unregisterTransformer();
}
