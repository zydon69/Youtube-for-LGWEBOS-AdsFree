import { runPinnedPnpm } from './pnpm-cli.js';

try {
  runPinnedPnpm(process.argv.slice(2), {
    encoding: 'utf8',
    stdio: 'inherit'
  });
} catch (error) {
  const status =
    error && typeof error === 'object' && 'status' in error
      ? error.status
      : undefined;
  const hasFailureStatus =
    typeof status === 'number' &&
    Number.isInteger(status) &&
    status > 0 &&
    status <= 255;
  if (!hasFailureStatus) console.error('[toolchain]', error);
  process.exitCode = hasFailureStatus ? status : 1;
}
