import {
  defineBootstrapModule,
  IsolatedBootstrap,
  type BootstrapReport
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

const inactiveBootstrapReport: BootstrapReport = {
  loaded: [],
  failures: [],
  aborted: false
};
export let bootstrapReport: Promise<BootstrapReport> = Promise.resolve(
  inactiveBootstrapReport
);

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
    'content-filters',
    async () => {
      const module = await import(
        /* webpackMode: "eager" */ './content-filters'
      );
      module.installContentFilters();
      return module;
    },
    (module: typeof import('./content-filters')) => module.dispose()
  ),
  defineBootstrapModule(
    'notifications',
    () => import(/* webpackMode: "eager" */ './core/notifications.js'),
    (module: typeof import('./core/notifications.js')) =>
      module.disposeNotifications()
  ),
  defineBootstrapModule(
    'ui',
    async () => {
      const module = await import(/* webpackMode: "eager" */ './ui.js');
      module.installUI();
      return module;
    },
    (module: typeof import('./ui.js')) => module.dispose()
  ),
  defineBootstrapModule(
    'sponsorblock',
    async () => {
      const module = await import(
        /* webpackMode: "eager" */ './sponsorblock.js'
      );
      module.installSponsorBlock();
      return module;
    },
    (module: typeof import('./sponsorblock.js')) => module.dispose()
  ),
  defineBootstrapModule(
    'thumbnail-quality',
    async () => {
      const module = await import(
        /* webpackMode: "eager" */ './thumbnail-quality'
      );
      module.installThumbnailQuality();
      return module;
    },
    (module: typeof import('./thumbnail-quality')) => module.dispose()
  ),
  defineBootstrapModule(
    'screensaver-fix',
    async () => {
      const module = await import(
        /* webpackMode: "eager" */ './screensaver-fix'
      );
      module.installScreensaverFix();
      return module;
    },
    (module: typeof import('./screensaver-fix')) => module.dispose()
  ),
  defineBootstrapModule(
    'youtube-styles',
    () => import(/* webpackMode: "eager" */ './yt-fixes.css')
  ),
  defineBootstrapModule(
    'watch',
    async () => {
      const module = await import(/* webpackMode: "eager" */ './watch.js');
      module.installWatch();
      return module;
    },
    (module: typeof import('./watch.js')) => module.dispose()
  ),
  defineBootstrapModule(
    'video-quality',
    async () => {
      const module = await import(/* webpackMode: "eager" */ './video-quality');
      await module.installVideoQuality();
      return module;
    },
    (module: typeof import('./video-quality')) => module.dispose()
  ),
  defineBootstrapModule(
    'language-settings',
    async () => {
      const module = await import(
        /* webpackMode: "eager" */ './lang-settings-fix'
      );
      module.installLanguageSettingsFix();
      return module;
    },
    (module: typeof import('./lang-settings-fix')) => module.dispose()
  ),
  defineBootstrapModule(
    'block-webos-cast',
    async () => {
      const module = await import(
        /* webpackMode: "eager" */ './block-webos-cast'
      );
      module.installBlockWebOSCast();
      return module;
    },
    (module: typeof import('./block-webos-cast')) => module.dispose()
  ),
  defineBootstrapModule(
    'auto-account-select',
    async () => {
      const module = await import(
        /* webpackMode: "eager" */ './auto-account-select'
      );
      await module.installAutoAccountSelectFeature();
      return module;
    },
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
  bootstrapReport = bootstrap.run(modules, bootstrapController?.signal);
  void bootstrapReport.then((report) => {
    document.dispatchEvent(
      new CustomEvent('ytafBootstrapComplete', {
        detail: {
          loaded: [...report.loaded],
          failures: report.failures.map(({ name }) => name),
          aborted: report.aborted
        }
      })
    );
  });
}
