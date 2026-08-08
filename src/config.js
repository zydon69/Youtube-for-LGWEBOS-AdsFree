import { normalizeConfig } from './core/config-schema.js';

const CONFIG_KEY = 'ytaf-configuration';

/** @typedef {{ key: string, newValue: boolean, oldValue: boolean }} ConfigChangeDetail */

const configOptions = new Map([
  ['enableAdBlock', { default: true, desc: 'Enable ad blocking' }],
  ['upgradeThumbnails', { default: false, desc: 'Upgrade thumbnail quality' }],
  [
    'removeShorts',
    { default: false, desc: 'Remove Shorts from subscriptions' }
  ],
  ['enableSponsorBlock', { default: true, desc: 'Enable SponsorBlock' }],
  [
    'enableSponsorBlockSponsor',
    { default: true, desc: 'Skip sponsor segments' }
  ],
  ['enableSponsorBlockIntro', { default: true, desc: 'Skip intro segments' }],
  ['enableSponsorBlockOutro', { default: true, desc: 'Skip outro segments' }],
  [
    'enableSponsorBlockInteraction',
    {
      default: true,
      desc: 'Skip interaction reminder segments'
    }
  ],
  [
    'enableSponsorBlockSelfPromo',
    {
      default: true,
      desc: 'Skip self promotion segments'
    }
  ],
  [
    'enableSponsorBlockMusicOfftopic',
    {
      default: true,
      desc: 'Skip non-music segments in music videos'
    }
  ],
  [
    'enableSponsorBlockPreview',
    {
      default: false,
      desc: 'Skip recaps and previews'
    }
  ],
  [
    'hideLogo',
    {
      default: false,
      desc: 'Hide YouTube logo'
    }
  ],
  [
    'showWatch',
    {
      default: false,
      desc: 'Display time in UI'
    }
  ],
  [
    'forceHighResVideo',
    {
      default: false,
      desc: 'Force max resolution video playback'
    }
  ],
  [
    'removeEndscreen',
    {
      default: false,
      desc: 'Remove end screens from video'
    }
  ],
  [
    'autoAccountSelect',
    {
      default: false,
      desc: 'Bypass initial account selection on startup'
    }
  ]
]);

const defaultConfig = (() => {
  const ret = {};
  for (const [k, v] of configOptions) {
    ret[k] = v.default;
  }
  return ret;
})();

/** @type {Record<string, DocumentFragment>} as const */
const configFrags = (() => {
  const ret = {};
  for (const k of configOptions.keys()) {
    ret[k] = new DocumentFragment();
  }
  return ret;
})();

function loadStoredConfig() {
  try {
    const storage = window.localStorage.getItem(CONFIG_KEY);
    if (storage === null) {
      console.info('Config not set; using defaults.');
      return normalizeConfig(null, defaultConfig);
    }

    return normalizeConfig(JSON.parse(storage), defaultConfig);
  } catch (err) {
    console.warn('Error parsing stored config:', err);
    return normalizeConfig(null, defaultConfig);
  }
}

const localConfig = loadStoredConfig();

function configExists(key) {
  return configOptions.has(key);
}

export function configGetDesc(key) {
  if (!configExists(key)) {
    throw new Error('tried to get desc for unknown config key: ' + key);
  }

  return configOptions.get(key).desc;
}

export function configRead(key) {
  if (!configExists(key)) {
    throw new Error('tried to read unknown config key: ' + key);
  }

  return localConfig[key];
}

export function configWrite(key, value) {
  if (!configExists(key)) {
    throw new Error('tried to write unknown config key: ' + key);
  }
  if (typeof value !== 'boolean') {
    throw new TypeError(`configuration value for "${key}" must be boolean`);
  }

  const oldValue = localConfig[key];

  console.info('Changing key', key, 'from', oldValue, 'to', value);
  localConfig[key] = value;
  try {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(localConfig));
  } catch (error) {
    localConfig[key] = oldValue;
    throw new Error(`failed to persist configuration key "${key}"`, {
      cause: error
    });
  }

  configFrags[key].dispatchEvent(
    new CustomEvent('ytafConfigChange', {
      detail: { key, newValue: value, oldValue }
    })
  );
}

/**
 * Add a listener for changes in the value of a specified config option
 * @param {string} key Config option to monitor
 * @param {(evt: CustomEvent<ConfigChangeDetail>) => void} callback Function to be called on change
 */
export function configAddChangeListener(key, callback) {
  if (!configExists(key)) {
    throw new Error('tried to observe unknown config key: ' + key);
  }
  const frag = configFrags[key];

  frag.addEventListener('ytafConfigChange', callback);
}

/**
 * Remove a listener for changes in the value of a specified config option
 * @param {string} key Config option to monitor
 * @param {(evt: CustomEvent<ConfigChangeDetail>) => void} callback Function to be called on change
 */
export function configRemoveChangeListener(key, callback) {
  if (!configExists(key)) {
    throw new Error('tried to stop observing unknown config key: ' + key);
  }
  const frag = configFrags[key];

  frag.removeEventListener('ytafConfigChange', callback);
}
