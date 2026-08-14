import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

import {
  installDOMGlobals,
  registerCSSModuleStub
} from './helpers/dom-runtime.js';

registerCSSModuleStub();

function waitFor(condition, message) {
  const deadline = Date.now() + 150;
  return new Promise((resolve, reject) => {
    const inspect = () => {
      if (condition()) resolve();
      else if (Date.now() >= deadline) reject(new Error(message));
      else setTimeout(inspect, 5);
    };
    inspect();
  });
}

test('account-selection wrapper installs lazily and follows configuration', async () => {
  const browser = new Window({ url: 'https://www.youtube.com/tv#/' });
  const restoreGlobals = installDOMGlobals(browser);
  const nativeCalls = [];
  const instance = {
    resolveCommand(payload) {
      nativeCalls.push(payload);
      return payload;
    }
  };
  const nativeResolveCommand = instance.resolveCommand;
  const constructor = function () {};
  constructor.instance = instance;
  browser._yttv = { accountCommand: constructor };

  let feature;
  let appAPI;
  try {
    const config = await import('../src/config.js');
    feature = await import('../src/auto-account-select.ts');
    appAPI = await import('../src/app_api/index.ts');
    await feature.installAutoAccountSelectFeature();
    assert.equal(instance.resolveCommand, nativeResolveCommand);

    config.configWrite('autoAccountSelect', true);
    await waitFor(
      () => instance.resolveCommand !== nativeResolveCommand,
      'account-selection hook installation timed out'
    );
    instance.resolveCommand({
      startAccountSelectorCommand: {
        selectAccountEndpoint: { accountItem: { accountName: 'first' } },
        nextEndpoint: { browseEndpoint: { browseId: 'home' } }
      },
      trackingParams: 'kept'
    });
    const selected = nativeCalls.pop();
    assert.equal('startAccountSelectorCommand' in selected, false);
    assert.equal(selected.trackingParams, 'kept');
    assert.deepEqual(
      selected.onIdentityChanged.identityActionContext.nextEndpoint,
      { browseEndpoint: { browseId: 'home' } }
    );

    config.configWrite('autoAccountSelect', false);
    const disabledCommand = {
      startAccountSelectorCommand: {
        nextEndpoint: { browseEndpoint: { browseId: 'disabled' } }
      }
    };
    instance.resolveCommand(disabledCommand);
    assert.equal(nativeCalls.pop(), disabledCommand);

    config.configWrite('autoAccountSelect', true);
    await feature.installAutoAccountSelect();
    const reenabledCommand = {
      startAccountSelectorCommand: {
        nextEndpoint: { browseEndpoint: { browseId: 'reenabled' } }
      }
    };
    instance.resolveCommand(reenabledCommand);
    assert.deepEqual(
      nativeCalls.pop().onIdentityChanged.identityActionContext.nextEndpoint,
      { browseEndpoint: { browseId: 'reenabled' } }
    );

    feature.dispose();
    feature.dispose();
    config.configWrite('autoAccountSelect', false);
    config.configWrite('autoAccountSelect', true);
    const disposedCommand = {
      startAccountSelectorCommand: {
        nextEndpoint: { browseEndpoint: { browseId: 'disposed' } }
      }
    };
    instance.resolveCommand(disposedCommand);
    assert.equal(nativeCalls.pop(), disposedCommand);
  } finally {
    feature?.dispose();
    appAPI?.dispose();
    restoreGlobals();
    await browser.close();
  }
});
