import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  DIST_DIRECTORY,
  EXPECTED_APP_FILES,
  PROJECT_ROOT,
  getBuildProvenance,
  hashDirectory
} from './package-contract.js';

export const DIST_FINGERPRINT_PATH = join(
  PROJECT_ROOT,
  'node_modules',
  '.cache',
  'ytaf-dist-fingerprint.json'
);

export async function currentDistFingerprint() {
  const provenance = await getBuildProvenance('development');
  return {
    sourceTreeSha256: provenance.sourceTreeSha256,
    distTreeSha256: await hashDirectory(DIST_DIRECTORY, EXPECTED_APP_FILES)
  };
}

export async function readDistFingerprint() {
  return JSON.parse(await readFile(DIST_FINGERPRINT_PATH, 'utf8'));
}
