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

  const hook: ResolveCommandHook = (resolveCommand, payload, extra) => {
    const endpoint = payload.setClientSettingEndpoint;
    if (!isRecord(endpoint) || !Array.isArray(endpoint.settingDatas)) {
      return resolveCommand(payload, extra);
    }

    const languageSetting = endpoint.settingDatas.find(isLanguageSetting);
    if (!isRecord(languageSetting)) return resolveCommand(payload, extra);

    const prefs = getPrefsCookie();
    prefs.set('hl', languageSetting.stringValue as string);
    const expires = new Date();
    expires.setFullYear(expires.getFullYear() + 10);
    document.cookie = `PREF=${prefs.toString()}; Domain=.youtube.com; Path=/; Secure; SameSite=Lax; expires=${expires.toUTCString()};`;

    const remainingSettings = endpoint.settingDatas.filter(
      (setting) => setting !== languageSetting
    );
    if (remainingSettings.length > 0) {
      const forwardedPayload: ResolveCommandPayload = {
        ...payload,
        setClientSettingEndpoint: {
          ...endpoint,
          settingDatas: remainingSettings
        }
      };
      resolveCommand(forwardedPayload, extra);
    }

    return resolveCommand({ signalAction: { signal: 'RELOAD_PAGE' } }, extra);
  };

  registry.setHook('setClientSettingEndpoint', hook);
}

void installLanguageSettingsFix().catch((error) => {
  console.warn('[lang-settings-fix] Feature unavailable', error);
});
