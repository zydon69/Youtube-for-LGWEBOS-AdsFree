import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  PROJECT_ROOT,
  getBuildProvenance,
  hashFile
} from './package-contract.js';
import {
  DIST_FINGERPRINT_PATH,
  currentDistFingerprint,
  readDistFingerprint
} from './dist-fingerprint.js';
import { runPinnedPnpm } from './pnpm-cli.js';

export const QA_RECEIPT_PATH = join(
  PROJECT_ROOT,
  'node_modules',
  '.cache',
  'ytaf-qa-receipt.json'
);

export async function currentQAReceipt() {
  const provenance = await getBuildProvenance('development');
  const dist = await currentDistFingerprint();
  assert.deepEqual(await readDistFingerprint(), dist);
  return {
    schemaVersion: 1,
    commit: provenance.commit,
    sourceTreeSha256: provenance.sourceTreeSha256,
    distTreeSha256: dist.distTreeSha256,
    lockfileSha256: await hashFile(join(PROJECT_ROOT, 'pnpm-lock.yaml')),
    node: process.versions.node,
    pnpm: runPinnedPnpm(['--version'], { encoding: 'utf8' }).trim()
  };
}

export async function assertCurrentQAReceipt() {
  let recorded;
  try {
    recorded = JSON.parse(await readFile(QA_RECEIPT_PATH, 'utf8'));
  } catch (error) {
    throw new Error('No QA receipt; run pnpm qa before packaging', {
      cause: error
    });
  }
  const current = await currentQAReceipt();
  assert.deepEqual(
    recorded,
    current,
    'QA receipt does not match current inputs'
  );
  return current;
}

export { DIST_FINGERPRINT_PATH };
