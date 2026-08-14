import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';

import { PROJECT_ROOT } from './package-contract.js';

const report = JSON.parse(
  await readFile(
    new URL('../coverage/coverage-summary.json', import.meta.url),
    'utf8'
  )
);
const exclusions = new Set(['src/userScript.ts']);
const minimums = { lines: 50, statements: 50, branches: 40, functions: 50 };
const failures = [];

for (const [absolutePath, metrics] of Object.entries(report)) {
  if (absolutePath === 'total') continue;
  const file = relative(PROJECT_ROOT, absolutePath);
  if (exclusions.has(file)) continue;
  for (const [metric, minimum] of Object.entries(minimums)) {
    const percentage = metrics?.[metric]?.pct;
    if (typeof percentage !== 'number' || percentage < minimum) {
      failures.push(
        `${file}: ${metric} ${percentage ?? 'missing'}% < ${minimum}%`
      );
    }
  }
}

if (failures.length > 0) {
  throw new Error(`Per-file coverage failed:\n${failures.join('\n')}`);
}
console.info(
  `Per-file coverage passed (${Object.entries(minimums)
    .map(([name, value]) => `${name}>=${value}%`)
    .join(', ')}; userScript entry is covered by browser tests)`
);
