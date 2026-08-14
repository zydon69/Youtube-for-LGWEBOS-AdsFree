import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** @param {string[]} arguments_ @param {import('node:child_process').ExecFileSyncOptionsWithStringEncoding} options */
export function runPinnedPnpm(arguments_, options) {
  const packageManagerCLI = process.env.npm_execpath;
  if (!packageManagerCLI || !/pnpm/i.test(path.basename(packageManagerCLI))) {
    throw new Error('The pinned pnpm CLI is unavailable in npm_execpath');
  }
  const isJavaScriptCLI = /\.(?:c?js|mjs)$/i.test(packageManagerCLI);
  const command = isJavaScriptCLI ? process.execPath : packageManagerCLI;
  const forwardedArguments = isJavaScriptCLI
    ? [packageManagerCLI, ...arguments_]
    : arguments_;
  return execFileSync(command, forwardedArguments, {
    cwd: options.cwd,
    encoding: options.encoding ?? 'utf8',
    env: options.env ?? process.env,
    shell: false,
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe']
  });
}
