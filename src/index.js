import { extractLaunchParams, handleLaunch } from './utils.js';

function main() {
  handleLaunch(extractLaunchParams());
}

main();
