import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import pkgJson from '../package.json' with { type: 'json' };
import {
  PROJECT_ROOT,
  artifactNames,
  assertPackageMetadata
} from './package-contract.js';

assertPackageMetadata(pkgJson);
const names = artifactNames(pkgJson.version);
const result = spawnSync('ares-install', [join(PROJECT_ROOT, names.ipk)], {
  stdio: 'inherit',
  shell: false
});

if (result.error) {
  throw new Error(
    'ares-install was not found. Install a trusted webOS CLI and expose it on PATH.',
    { cause: result.error }
  );
}

process.exit(result.status ?? 1);
