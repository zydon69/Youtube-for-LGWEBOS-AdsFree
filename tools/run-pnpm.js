import { runPinnedPnpm } from './pnpm-cli.js';

try {
  runPinnedPnpm(process.argv.slice(2), {
    encoding: 'utf8',
    stdio: 'inherit'
  });
} catch (error) {
  const status =
    error && typeof error === 'object' && 'status' in error
      ? Number(error.status)
      : 1;
  if (!Number.isInteger(status)) console.error('[toolchain]', error);
  process.exitCode = Number.isInteger(status) ? status : 1;
}
