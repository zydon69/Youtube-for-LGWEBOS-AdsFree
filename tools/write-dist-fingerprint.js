import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { writeFileAtomic } from './package-contract.js';
import {
  DIST_FINGERPRINT_PATH,
  currentDistFingerprint
} from './dist-fingerprint.js';

await mkdir(dirname(DIST_FINGERPRINT_PATH), { recursive: true });
await writeFileAtomic(
  DIST_FINGERPRINT_PATH,
  `${JSON.stringify(await currentDistFingerprint(), null, 2)}\n`
);
