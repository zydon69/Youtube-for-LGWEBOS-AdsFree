import pkgJson from '../package.json' with { type: 'json' };
import { REQUIRED_NODE_MAJOR, assertBuildNode } from './package-contract.js';

assertBuildNode();

const expectedPnpmVersion = pkgJson.packageManager.match(/^pnpm@([^+]+)/)?.[1];
const userAgent = process.env.npm_config_user_agent;

if (
  expectedPnpmVersion &&
  userAgent &&
  !userAgent.startsWith(`pnpm/${expectedPnpmVersion} `)
) {
  throw new Error(
    `pnpm ${expectedPnpmVersion} is required; received ${userAgent.split(' ')[0]}.`
  );
}

console.info(
  `Toolchain accepted: Node.js ${process.versions.node} (${REQUIRED_NODE_MAJOR}.x required)` +
    (expectedPnpmVersion ? `, pnpm ${expectedPnpmVersion}` : '')
);
