import 'whatwg-fetch';
import './domrect-polyfill';

import { handleLaunch } from './utils';

document.addEventListener(
  'webOSRelaunch',
  (evt) => {
    console.info('RELAUNCH:', evt, window.launchParams);
    handleLaunch(evt.detail);
  },
  true
);

import './app_api/index';
import './hooks/json';
import './adblock.js';
import './shorts.js';
import './sponsorblock.js';
import './ui.js';
import './thumbnail-quality';
import './screensaver-fix';
import './yt-fixes.css';
import './watch.js';
import './video-quality';
import './lang-settings-fix';
import './remove-endscreen';
import './hooks';
import './block-webos-cast';
import './auto-account-select';
import { restoreJSONHooks } from './hooks/json';
import { FetchRegistry } from './hooks';
import { ResolveCommandRegistry } from './app_api';

window.addEventListener(
  'pagehide',
  () => {
    restoreJSONHooks();
    FetchRegistry.getInstance().dispose();
    ResolveCommandRegistry.destroyInstance();
  },
  { once: true }
);
