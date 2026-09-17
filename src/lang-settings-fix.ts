import {
  ResolveCommandRegistry,
  type ResolveCommandHook,
  type ResolveCommandPayload
} from './app_api/index.ts';

let disposed = false;
let installedRegistry: ResolveCommandRegistry | null = null;

function getPrefsCookies() {
  return document.cookie
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('PREF='))
    .map((part) => new URLSearchParams(part.slice(5)));
}

function persistLanguage(language: string) {
  const prefs = new URLSearchParams();
  // The first visible cookie is the one the host reads; retain its values
  // while preserving non-conflicting preferences from other visible scopes.
  for (const cookie of getPrefsCookies()) {
    cookie.forEach((value, key) => {
      if (!prefs.has(key)) prefs.set(key, value);
    });
  }
  prefs.set('hl', language);
  const hostname = window.location.hostname;
  const domain =
    hostname === 'youtube.com' || hostname.endsWith('.youtube.com')
      ? 'youtube.com'
      : hostname;
  const value = prefs.toString();
  const attributes = '; Secure; SameSite=Lax';
  document.cookie = `PREF=${value}; Path=/; Domain=${domain}; Max-Age=34560000${attributes}`;
  if (!getPrefsCookies().some((cookie) => cookie.toString() === value))
    return false;

  // Migrate visible host-only and path-specific cookies. Cookie scope is not
  // exposed by document.cookie, so enumerate only applicable domain/path scopes.
  const paths = new Set(['/']);
  const pathname = window.location.pathname;
  for (let index = 1; index <= pathname.length; index++) {
    if (index === pathname.length || pathname[index] === '/') {
      paths.add(pathname.slice(0, index));
      paths.add(`${pathname.slice(0, index)}/`);
    }
  }
  const domains = new Set(['', hostname, domain]);
  for (const path of paths) {
    for (const scope of domains) {
      if (scope === domain && path === '/') continue;
      document.cookie = `PREF=; Path=${path}${scope ? `; Domain=${scope}` : ''}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${attributes}`;
    }
  }
  // On the apex domain, a host-only and domain cookie can share an identity.
  document.cookie = `PREF=${value}; Path=/; Domain=${domain}; Max-Age=34560000${attributes}`;
  const persisted = getPrefsCookies();
  return (
    persisted.length > 0 &&
    persisted.every((cookie) => cookie.get('hl') === language)
  );
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
  if (installedRegistry) return;
  const registry = ResolveCommandRegistry.getDeferredInstance();
  disposed = false;

  const hook: ResolveCommandHook = (payload) => {
    const endpoint = payload.setClientSettingEndpoint;
    if (!isRecord(endpoint) || !Array.isArray(endpoint.settingDatas)) {
      return payload;
    }

    const languageSettings = endpoint.settingDatas.filter(isLanguageSetting);
    if (languageSettings.length === 0) return payload;

    const languageSetting = languageSettings[languageSettings.length - 1]!;
    if (!persistLanguage(languageSetting.stringValue as string)) {
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
