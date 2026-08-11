import {
  defineBootstrapModule,
  IsolatedBootstrap
} from './core/isolated-bootstrap';
import { isTrustedRuntimeContext } from './core/runtime-context';
import { handleLaunch } from './utils';

type JSONHooksModule = typeof import('./hooks/json');
type FetchHooksModule = typeof import('./hooks/fetch');

let jsonHooks: JSONHooksModule | null = null;
let fetchHooks: FetchHooksModule | null = null;

const bootstrap = new IsolatedBootstrap();
const bootstrapController =
  typeof AbortController === 'function' ? new AbortController() : null;

const modules = [
  defineBootstrapModule(
    'fetch-polyfill',
    // @ts-expect-error -- whatwg-fetch intentionally ships no type declaration.
    () => import(/* webpackMode: "eager" */ 'whatwg-fetch')
  ),
  defineBootstrapModule(
    'domrect-polyfill',
    () => import(/* webpackMode: "eager" */ './domrect-polyfill')
  ),
  defineBootstrapModule(
    'json-hooks',
    async () => {
      const module = await import(/* webpackMode: "eager" */ './hooks/json');
      jsonHooks = module;
      module.synchronizeJSONHooks();
      return module;
    },
    (module: JSONHooksModule) => module.restoreJSONHooks()
  ),
  defineBootstrapModule(
    'fetch-hooks',
    async () => {
      const module = await import(/* webpackMode: "eager" */ './hooks/fetch');
      fetchHooks = module;
      module.FetchRegistry.getInstance().synchronize();
      return module;
    },
    (module: FetchHooksModule) => module.disposeFetchRegistry()
  ),
  defineBootstrapModule(
    'command-registry',
    () => import(/* webpackMode: "eager" */ './app_api/index'),
    (module: typeof import('./app_api/index')) => module.dispose()
  ),
  defineBootstrapModule(
    'player-manager',
    () => import(/* webpackMode: "eager" */ './player_api/manager'),
    (module: typeof import('./player_api/manager')) =>
      module.destroyPlayerManager()
  ),
  defineBootstrapModule(
    'dom-mutation-coordinator',
    () => import(/* webpackMode: "eager" */ './core/dom-mutations.js'),
    (module: typeof import('./core/dom-mutations.js')) =>
      module.disconnectDOMMutationCoordinator()
  ),
  defineBootstrapModule(
    'adblock',
    () => import(/* webpackMode: "eager" */ './adblock.js'),
    (module: typeof import('./adblock.js')) => module.dispose()
  ),
  defineBootstrapModule(
    'shorts',
    () => import(/* webpackMode: "eager" */ './shorts.js'),
    (module: typeof import('./shorts.js')) => module.dispose()
  ),
  defineBootstrapModule(
    'ui',
    () => import(/* webpackMode: "eager" */ './ui.js'),
    (module: typeof import('./ui.js')) => module.dispose()
  ),
  defineBootstrapModule(
    'sponsorblock',
    () => import(/* webpackMode: "eager" */ './sponsorblock.js'),
    (module: typeof import('./sponsorblock.js')) => module.dispose()
  ),
  defineBootstrapModule(
    'thumbnail-quality',
    () => import(/* webpackMode: "eager" */ './thumbnail-quality'),
    (module: typeof import('./thumbnail-quality')) => module.dispose()
  ),
  defineBootstrapModule(
    'screensaver-fix',
    () => import(/* webpackMode: "eager" */ './screensaver-fix'),
    (module: typeof import('./screensaver-fix')) => module.dispose()
  ),
  defineBootstrapModule(
    'youtube-styles',
    () => import(/* webpackMode: "eager" */ './yt-fixes.css')
  ),
  defineBootstrapModule(
    'watch',
    () => import(/* webpackMode: "eager" */ './watch.js'),
    (module: typeof import('./watch.js')) => module.dispose()
  ),
  defineBootstrapModule(
    'video-quality',
    () => import(/* webpackMode: "eager" */ './video-quality'),
    (module: typeof import('./video-quality')) => module.dispose()
  ),
  defineBootstrapModule(
    'language-settings',
    () => import(/* webpackMode: "eager" */ './lang-settings-fix'),
    (module: typeof import('./lang-settings-fix')) => module.dispose()
  ),
  defineBootstrapModule(
    'remove-endscreen',
    () => import(/* webpackMode: "eager" */ './remove-endscreen'),
    (module: typeof import('./remove-endscreen')) => module.dispose()
  ),
  defineBootstrapModule(
    'block-webos-cast',
    () => import(/* webpackMode: "eager" */ './block-webos-cast'),
    (module: typeof import('./block-webos-cast')) => module.dispose()
  ),
  defineBootstrapModule(
    'auto-account-select',
    () => import(/* webpackMode: "eager" */ './auto-account-select'),
    (module: typeof import('./auto-account-select')) => module.dispose()
  )
] as const;

function handleRelaunch(event: CustomEvent<Record<string, unknown>>) {
  try {
    jsonHooks?.synchronizeJSONHooks();
    fetchHooks?.FetchRegistry.getInstance().synchronize();
    handleLaunch(event.detail);
  } catch (error) {
    console.error('[bootstrap] Unable to handle webOS relaunch', error);
  }
}

function handlePageShow(event: PageTransitionEvent) {
  if (!event.persisted) return;
  try {
    jsonHooks?.synchronizeJSONHooks();
    fetchHooks?.FetchRegistry.getInstance().synchronize();
  } catch (error) {
    console.error('[bootstrap] Unable to rebind runtime hooks', error);
  }
}

function handlePageHide(event: PageTransitionEvent) {
  if (event.persisted) return;
  window.removeEventListener('pagehide', handlePageHide, false);
  bootstrapController?.abort();
  bootstrap.dispose();
  document.removeEventListener(
    'webOSRelaunch',
    handleRelaunch as EventListener,
    true
  );
  window.removeEventListener('pageshow', handlePageShow, false);
}

if (isTrustedRuntimeContext(window)) {
  document.addEventListener('webOSRelaunch', handleRelaunch, true);
  window.addEventListener('pageshow', handlePageShow, false);
  window.addEventListener('pagehide', handlePageHide, false);
  void bootstrap.run(modules, bootstrapController?.signal);
}
