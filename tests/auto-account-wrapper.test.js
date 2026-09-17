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

test('account-selection bypasses only the first valid startup selector and never re-arms', async () => {
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
    const refusedCommands = [
      { startAccountSelectorCommand: null },
      { startAccountSelectorCommand: { nextEndpoint: {} } },
      { startAccountSelectorCommand: { nextEndpoint: [] } },
      {
        startAccountSelectorCommand: { nextEndpoint: { browseEndpoint: {} } },
        onIdentityChanged: {}
      }
    ];
    for (const command of refusedCommands) {
      instance.resolveCommand(command);
      assert.equal(nativeCalls.pop(), command);
    }
    instance.resolveCommand({
      startAccountSelectorCommand: {
        selectAccountEndpoint: { accountItem: { accountName: 'first' } },
        nextEndpoint: { browseEndpoint: { browseId: 'home' } }
      },
      trackingParams: 'kept',
      commandMetadata: { extra: 'retained', webCommandMetadata: { url: '/tv' } }
    });
    const selected = nativeCalls.pop();
    assert.equal('startAccountSelectorCommand' in selected, false);
    assert.equal(selected.trackingParams, 'kept');
    assert.deepEqual(selected.commandMetadata, {
      extra: 'retained',
      webCommandMetadata: { url: '/tv', clientAction: true }
    });
    const manual = {
      startAccountSelectorCommand: {
        nextEndpoint: { browseEndpoint: { browseId: 'manual' } }
      }
    };
    instance.resolveCommand(manual);
    assert.equal(nativeCalls.pop(), manual);
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
    assert.equal(nativeCalls.pop(), reenabledCommand);

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
    feature.installAutoAccountSelectFeature();
    instance.resolveCommand(disposedCommand);
    assert.equal(nativeCalls.pop(), disposedCommand);
  } finally {
    feature?.dispose();
    appAPI?.dispose();
    restoreGlobals();
    await browser.close();
  }
});

test('account startup installation completes without a target and disposal cancels late effects', async () => {
  const browser = new Window({ url: 'https://www.youtube.com/tv#/' });
  const restoreGlobals = installDOMGlobals(browser);
  let synchronize;
  const originalInterval = browser.setInterval;
  browser.setInterval = (callback) => {
    synchronize = callback;
    return 1;
  };
  let feature;
  let appAPI;
  try {
    const config = await import('../src/config.js');
    config.configWrite('autoAccountSelect', true);
    feature = await import('../src/auto-account-select.ts?late-startup');
    appAPI = await import('../src/app_api/index.ts');
    assert.equal(feature.installAutoAccountSelectFeature(), undefined);
    assert.equal(typeof synchronize, 'function');
    feature.dispose();
    const calls = [];
    function Command() {}
    Command.instance = {
      resolveCommand(payload) {
        calls.push(payload);
      }
    };
    browser._yttv = { Command };
    synchronize();
    const command = {
      startAccountSelectorCommand: {
        nextEndpoint: { browseEndpoint: { browseId: 'late' } }
      }
    };
    Command.instance.resolveCommand(command);
    assert.equal(calls.pop(), command);
    feature.installAutoAccountSelectFeature();
    config.configWrite('autoAccountSelect', false);
    Command.instance.resolveCommand(command);
    assert.equal(calls.pop(), command);
    config.configWrite('autoAccountSelect', true);
    Command.instance.resolveCommand(command);
    assert.equal('startAccountSelectorCommand' in calls.pop(), false);
    Command.instance.resolveCommand(command);
    assert.equal(calls.pop(), command);
    appAPI.dispose();
    const capturedSynchronization = synchronize;
    capturedSynchronization();
    Command.instance.resolveCommand(command);
    assert.equal(calls.pop(), command);
  } finally {
    feature?.dispose();
    appAPI?.dispose();
    browser.setInterval = originalInterval;
    restoreGlobals();
    await browser.close();
  }
});
