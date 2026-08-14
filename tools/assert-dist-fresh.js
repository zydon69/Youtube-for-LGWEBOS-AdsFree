import assert from 'node:assert/strict';

import {
  currentDistFingerprint,
  readDistFingerprint
} from './dist-fingerprint.js';

let recorded;
try {
  recorded = await readDistFingerprint();
} catch (error) {
  throw new Error('No verified dist fingerprint; run pnpm build first', {
    cause: error
  });
}
const current = await currentDistFingerprint();
assert.deepEqual(
  recorded,
  current,
  'dist is stale or was modified; run pnpm build first'
);
console.info('dist fingerprint matches the current source and output trees');
