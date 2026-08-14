import {
  ResolveCommandRegistry,
  type ResolveCommandHook,
  type ResolveCommandPayload
} from './app_api/index.ts';

let disposed = false;
let installedRegistry: ResolveCommandRegistry | null = null;

function getPrefsCookie() {
  const prefix = 'PREF=';
  const raw = document.cookie
    .split(';')
    .map((cookie) => cookie.trim())
    .find((value) => value.startsWith(prefix));
  return new URLSearchParams(raw?.slice(prefix.length) ?? '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isLanguageSetting(value: unknown) {
  if (!isRecord(value) || !isRecord(value.clientSettingEnum)) return false;
  return (
    value.clientSettingEnum.item === 'I18N_LANGUAGE' &&
    typeof value.stringValue === 'string' &&
    value.stringValue.length > 0
  );
}

export function installLanguageSettingsFix() {
  const registry = ResolveCommandRegistry.getDeferredInstance();
  if (disposed) return;

  const hook: ResolveCommandHook = (payload) => {
    const endpoint = payload.setClientSettingEndpoint;
    if (!isRecord(endpoint) || !Array.isArray(endpoint.settingDatas)) {
      return payload;
    }

    const languageSettings = endpoint.settingDatas.filter(isLanguageSetting);
    if (languageSettings.length === 0) return payload;

    const prefs = getPrefsCookie();
    const languageSetting = languageSettings[languageSettings.length - 1]!;
    prefs.set('hl', languageSetting.stringValue as string);
    const expires = new Date();
    expires.setFullYear(expires.getFullYear() + 10);
    const encodedPrefs = prefs.toString();
    document.cookie = `PREF=${encodedPrefs}; Path=/; Secure; SameSite=Lax; expires=${expires.toUTCString()};`;
    if (getPrefsCookie().get('hl') !== languageSetting.stringValue) {
      console.warn('[lang-settings-fix] PREF cookie write was rejected');
      return payload;
    }

    const remainingSettings = endpoint.settingDatas.filter(
      (setting) => !isLanguageSetting(setting)
    );
    const remainingPayload: ResolveCommandPayload = { ...payload };
    if (remainingSettings.length > 0) {
      remainingPayload.setClientSettingEndpoint = {
        ...endpoint,
        settingDatas: remainingSettings
      };
    } else {
      delete remainingPayload.setClientSettingEndpoint;
    }

    const commands: ResolveCommandPayload[] = [];
    // A resolveCommand payload can contain independent sibling commands. Only
    // consume the language endpoint; never discard those siblings.
    if (Object.keys(remainingPayload).length > 0)
      commands.push(remainingPayload);
    commands.push({ signalAction: { signal: 'RELOAD_PAGE' } });
    return commands;
  };

  registry.setHook('setClientSettingEndpoint', hook);
  installedRegistry = registry;
}

export function dispose() {
  if (disposed) return;
  disposed = true;
  installedRegistry?.removeHook('setClientSettingEndpoint');
  installedRegistry = null;
}
