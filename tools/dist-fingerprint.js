import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  DIST_DIRECTORY,
  EXPECTED_APP_FILES,
  EXPECTED_DEVELOPMENT_FILES,
  PROJECT_ROOT,
  getBuildProvenance,
  hashDirectory,
  listRelativeFiles
} from './package-contract.js';

export const DIST_FINGERPRINT_PATH = join(
  PROJECT_ROOT,
  'node_modules',
  '.cache',
  'ytaf-dist-fingerprint.json'
);

/** @param {string} directory @param {boolean} development */
export async function hashDistDirectory(directory, development) {
  const expected = development
    ? EXPECTED_DEVELOPMENT_FILES
    : EXPECTED_APP_FILES;
  assert.deepEqual(
    await listRelativeFiles(directory),
    [...expected].sort(),
    'Unexpected distribution file tree'
  );
  return hashDirectory(directory, expected);
}

/** @param {boolean} [development] */
export async function currentDistFingerprint(development = false) {
  const provenance = await getBuildProvenance('development');
  return {
    development,
    sourceTreeSha256: provenance.sourceTreeSha256,
    distTreeSha256: await hashDistDirectory(DIST_DIRECTORY, development)
  };
}

export async function readDistFingerprint() {
  return JSON.parse(await readFile(DIST_FINGERPRINT_PATH, 'utf8'));
}
