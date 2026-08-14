import { normalizeConfig } from './core/config-schema.js';
import { SPONSORBLOCK_CATEGORY_OPTIONS } from './core/sponsorblock-categories.js';
import { CustomEventTarget, TypedCustomEvent } from './custom-event-target.ts';

const CONFIG_KEY = 'ytaf-configuration-v2';
const LEGACY_CONFIG_KEY = 'ytaf-configuration';

/** @typedef {{ key: string, newValue: boolean, oldValue: boolean }} ConfigChangeDetail */
/** @typedef {{ default: boolean, desc: string }} ConfigOption */

/** @type {Array<[string, ConfigOption]>} */
const optionEntries = [
  ['enableAdBlock', { default: true, desc: 'Enable ad blocking' }],
  ['upgradeThumbnails', { default: false, desc: 'Upgrade thumbnail quality' }],
  [
    'removeShorts',
    { default: false, desc: 'Remove Shorts from YouTube browsing surfaces' }
  ],
  [
    'enableSponsorBlock',
    {
      default: false,
      desc: 'Enable SponsorBlock (sends a hashed video prefix to sponsor.ajay.app)'
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
];
for (const option of SPONSORBLOCK_CATEGORY_OPTIONS) {
  optionEntries.push([
    option.configKey,
    { default: option.default, desc: option.description }
  ]);
}

/** @type {Map<string, ConfigOption>} */
export const configOptions = new Map(optionEntries);

const defaultConfig = (() => {
  /** @type {Record<string, boolean>} */
  const ret = {};
  for (const [k, v] of configOptions) {
    ret[k] = v.default;
  }
  return ret;
})();

/** @type {Map<string, CustomEventTarget<any>>} */
const configFrags = (() => {
  const ret = new Map();
  for (const k of configOptions.keys()) {
    ret.set(k, new CustomEventTarget());
  }
  return ret;
})();

/** @param {Record<string, boolean>} config @param {boolean} removeLegacy */
function persistNormalizedConfig(config, removeLegacy = false) {
  try {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    if (removeLegacy && typeof window.localStorage.removeItem === 'function') {
      window.localStorage.removeItem(LEGACY_CONFIG_KEY);
    }
    return true;
  } catch (error) {
    console.warn('[config] Unable to repair stored configuration:', error);
    return false;
  }
}

function loadStoredConfig() {
  let normalized = normalizeConfig(null, defaultConfig);
  let shouldPersist;
  let removeLegacy = false;

  let storage = null;
  try {
    storage = window.localStorage.getItem(CONFIG_KEY);
  } catch (error) {
    console.warn('[config] Unable to read v2 configuration:', error);
  }
  if (storage !== null) {
    try {
      const parsed = JSON.parse(storage);
      normalized = normalizeConfig(parsed, defaultConfig);
      shouldPersist = JSON.stringify(parsed) !== JSON.stringify(normalized);
    } catch (error) {
      console.warn('[config] Invalid v2 configuration:', error);
    }
  }

  if (shouldPersist === undefined) {
    let legacyStorage = null;
    try {
      legacyStorage = window.localStorage.getItem(LEGACY_CONFIG_KEY);
    } catch (error) {
      console.warn('[config] Unable to read legacy configuration:', error);
    }
    if (legacyStorage !== null) {
      try {
        normalized = normalizeConfig(JSON.parse(legacyStorage), defaultConfig);
        // Previous releases enabled the third-party service by default. An
        // upgrade must require a fresh, explicit opt-in.
        normalized.enableSponsorBlock = false;
        shouldPersist = true;
        removeLegacy = true;
      } catch (error) {
        console.warn('[config] Invalid legacy configuration:', error);
      }
    }
    if (shouldPersist === undefined) {
      normalized = normalizeConfig(null, defaultConfig);
      shouldPersist = true;
    }
  }

  if (shouldPersist) persistNormalizedConfig(normalized, removeLegacy);

  return normalized;
}

const localConfig = loadStoredConfig();

/** @param {string} key */
function configExists(key) {
  return configOptions.has(key);
}

/** @param {string} key */
export function configGetDesc(key) {
  if (!configExists(key)) {
    throw new Error('tried to get desc for unknown config key: ' + key);
  }

  return configOptions.get(key)?.desc ?? '';
}

/** @param {string} key */
export function configRead(key) {
  if (!configExists(key)) {
    throw new Error('tried to read unknown config key: ' + key);
  }

  const value = localConfig[key];
  if (value === undefined) throw new Error(`missing config value: ${key}`);
  return value;
}

/** @param {string} key @param {boolean} value */
export function configWrite(key, value) {
  if (!configExists(key)) {
    throw new Error('tried to write unknown config key: ' + key);
  }
  if (typeof value !== 'boolean') {
    throw new TypeError(`configuration value for "${key}" must be boolean`);
  }

  const oldValue = localConfig[key];
  if (oldValue === undefined) throw new Error(`missing config value: ${key}`);
  if (oldValue === value) return;

  localConfig[key] = value;
  try {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(localConfig));
  } catch (error) {
    localConfig[key] = oldValue;
    throw new Error(`failed to persist configuration key "${key}"`, {
      cause: error
    });
  }

  configFrags.get(key)?.dispatchEvent(
    new TypedCustomEvent('ytafConfigChange', {
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
  const frag = configFrags.get(key);
  if (!frag) throw new Error(`missing config event target: ${key}`);

  frag.addEventListener('ytafConfigChange', callback);
  return () => frag.removeEventListener('ytafConfigChange', callback);
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
  const frag = configFrags.get(key);
  if (!frag) throw new Error(`missing config event target: ${key}`);

  frag.removeEventListener('ytafConfigChange', callback);
}
