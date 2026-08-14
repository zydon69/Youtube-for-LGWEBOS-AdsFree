import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { writeFileAtomic } from './package-contract.js';
import { QA_RECEIPT_PATH, currentQAReceipt } from './qa-receipt.js';

await mkdir(dirname(QA_RECEIPT_PATH), { recursive: true });
await writeFileAtomic(
  QA_RECEIPT_PATH,
  `${JSON.stringify(await currentQAReceipt(), null, 2)}\n`
);
console.info('QA receipt bound to the current source, lockfile and dist tree');
