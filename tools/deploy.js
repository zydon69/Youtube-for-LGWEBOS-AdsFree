import { spawnSync } from 'node:child_process';
import pkgJson from '../package.json' with { type: 'json' };

const result = spawnSync(
  'ares-install',
  [`./youtube.leanback.v4_${pkgJson.version}_all.ipk`],
  { stdio: 'inherit', shell: false }
);

if (result.error) {
  throw new Error(
    'ares-install was not found. Install a trusted webOS CLI and expose it on PATH.',
    { cause: result.error }
  );
}

process.exit(result.status ?? 1);
