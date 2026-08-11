import {
  ResolveCommandRegistry,
  type ResolveCommandHook,
  type ResolveCommandPayload
} from './app_api';

function getPrefsCookie() {
  const prefix = 'PREF=';
  const raw = document.cookie
    .split('; ')
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

export async function installLanguageSettingsFix() {
  const registry = await ResolveCommandRegistry.getInstance();

  const hook: ResolveCommandHook = (payload) => {
    const endpoint = payload.setClientSettingEndpoint;
    if (!isRecord(endpoint) || !Array.isArray(endpoint.settingDatas)) {
      return payload;
    }

    const languageSettings = endpoint.settingDatas.filter(isLanguageSetting);
    if (languageSettings.length === 0) return payload;

    const prefs = getPrefsCookie();
    const languageSetting = languageSettings.at(-1)!;
    prefs.set('hl', languageSetting.stringValue as string);
    const expires = new Date();
    expires.setFullYear(expires.getFullYear() + 10);
    const encodedPrefs = prefs.toString();
    document.cookie = `PREF=${encodedPrefs}; Domain=.youtube.com; Path=/; Secure; SameSite=Lax; expires=${expires.toUTCString()};`;
    if (getPrefsCookie().get('hl') !== languageSetting.stringValue) {
      console.warn('[lang-settings-fix] PREF cookie write was rejected');
      return payload;
    }

    const remainingSettings = endpoint.settingDatas.filter(
      (setting) => !isLanguageSetting(setting)
    );
    const commands: ResolveCommandPayload[] = [];
    if (remainingSettings.length > 0) {
      commands.push({
        ...payload,
        setClientSettingEndpoint: {
          ...endpoint,
          settingDatas: remainingSettings
        }
      });
    }

    commands.push({ signalAction: { signal: 'RELOAD_PAGE' } });
    return commands;
  };

  registry.setHook('setClientSettingEndpoint', hook);
}

void installLanguageSettingsFix().catch((error) => {
  console.warn('[lang-settings-fix] Feature unavailable', error);
});
