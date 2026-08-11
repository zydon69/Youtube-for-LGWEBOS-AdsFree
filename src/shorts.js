import { configRead } from './config';
import {
  hasRemovableShorts,
  removeShortsFromResponse
} from './core/json-transforms';
import { registerJSONParseTransformer } from './hooks/json';

const unregisterTransformer = registerJSONParseTransformer(
  'shorts',
  removeShortsFromResponse,
  () => configRead('removeShorts'),
  hasRemovableShorts
);

export function dispose() {
  unregisterTransformer();
}
