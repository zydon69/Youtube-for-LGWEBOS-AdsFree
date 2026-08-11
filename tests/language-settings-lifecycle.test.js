import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

import { installDOMGlobals } from './helpers/dom-runtime.js';

function waitForWrapper(instance, originalResolveCommand) {
  const deadline = Date.now() + 100;
  return new Promise((resolve, reject) => {
    const inspect = () => {
      if (instance.resolveCommand !== originalResolveCommand) {
        resolve();
      } else if (Date.now() >= deadline) {
        reject(new Error('resolveCommand hook installation timed out'));
      } else {
        setTimeout(inspect, 5);
      }
    };
    inspect();
  });
}

test('language setting interception preserves siblings and is removable', async () => {
  const browser = new Window({ url: 'https://www.youtube.com/tv#/' });
  const restoreGlobals = installDOMGlobals(browser);
  const nativeCalls = [];
  const instance = {
    resolveCommand(payload, extra) {
      nativeCalls.push({ payload, extra });
      return payload;
    }
  };
  const originalResolveCommand = instance.resolveCommand;
  const constructor = function () {};
  constructor.instance = instance;
  browser._yttv = { languageCommand: constructor };
  browser.document.cookie = 'PREF=f6=400&hl=fr; Path=/; Secure; SameSite=Lax';

  let languageFix;
  let appAPI;
  try {
    languageFix = await import('../src/lang-settings-fix.ts');
    appAPI = await import('../src/app_api/index.ts');
    await waitForWrapper(instance, originalResolveCommand);
    assert.notEqual(instance.resolveCommand, originalResolveCommand);

    const ordinarySetting = {
      clientSettingEnum: { item: 'THEME' },
      stringValue: 'DARK'
    };
    const malformedLanguage = {
      clientSettingEnum: { item: 'I18N_LANGUAGE' },
      stringValue: ''
    };
    instance.resolveCommand(
      {
        trackingParams: 'kept',
        independentSibling: { enabled: true },
        setClientSettingEndpoint: {
          metadata: { source: 'host' },
          settingDatas: [
            ordinarySetting,
            {
              clientSettingEnum: { item: 'I18N_LANGUAGE' },
              stringValue: 'de'
            },
            malformedLanguage,
            {
              clientSettingEnum: { item: 'I18N_LANGUAGE' },
              stringValue: 'es'
            }
          ]
        }
      },
      'host-extra'
    );

    assert.equal(nativeCalls.length, 2);
    assert.deepEqual(nativeCalls[0], {
      payload: {
        trackingParams: 'kept',
        independentSibling: { enabled: true },
        setClientSettingEndpoint: {
          metadata: { source: 'host' },
          settingDatas: [ordinarySetting, malformedLanguage]
        }
      },
      extra: 'host-extra'
    });
    assert.deepEqual(nativeCalls[1], {
      payload: { signalAction: { signal: 'RELOAD_PAGE' } },
      extra: 'host-extra'
    });
    const prefs = new URLSearchParams(
      browser.document.cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('PREF='))
        ?.slice(5)
    );
    assert.equal(prefs.get('f6'), '400');
    assert.equal(prefs.get('hl'), 'es');

    nativeCalls.length = 0;
    const persistedCookie = browser.document.cookie;
    Object.defineProperty(browser.document, 'cookie', {
      configurable: true,
      get: () => persistedCookie,
      set() {}
    });
    const rejectedCookieCommand = {
      setClientSettingEndpoint: {
        settingDatas: [
          {
            clientSettingEnum: { item: 'I18N_LANGUAGE' },
            stringValue: 'ja'
          }
        ]
      }
    };
    const previousWarn = console.warn;
    console.warn = () => undefined;
    try {
      instance.resolveCommand(rejectedCookieCommand);
    } finally {
      console.warn = previousWarn;
    }
    assert.equal(nativeCalls.length, 1);
    assert.equal(nativeCalls[0].payload, rejectedCookieCommand);
    delete browser.document.cookie;

    languageFix.dispose();
    languageFix.dispose();
    nativeCalls.length = 0;
    const untouched = {
      setClientSettingEndpoint: {
        settingDatas: [
          {
            clientSettingEnum: { item: 'I18N_LANGUAGE' },
            stringValue: 'it'
          }
        ]
      }
    };
    instance.resolveCommand(untouched);
    assert.equal(nativeCalls.length, 1);
    assert.equal(nativeCalls[0].payload, untouched);
  } finally {
    languageFix?.dispose();
    appAPI?.dispose();
    restoreGlobals();
    await browser.close();
  }
});
