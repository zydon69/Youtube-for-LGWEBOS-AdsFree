import assert from 'node:assert/strict';
import test from 'node:test';

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

globalThis.window = { localStorage: new MemoryStorage() };
globalThis.DocumentFragment = class extends EventTarget {};
globalThis.window.localStorage.setItem(
  'ytaf-configuration',
  JSON.stringify({ enableSponsorBlock: true, upgradeThumbnails: true })
);

const { configAddChangeListener, configRead, configWrite } =
  await import('../src/config.js');

test('third-party SponsorBlock requests require explicit opt-in', () => {
  assert.equal(configRead('enableSponsorBlock'), false);
  assert.equal(configRead('upgradeThumbnails'), true);
});

test('configuration changes expose the new boolean value', () => {
  let observedValue;
  configAddChangeListener('upgradeThumbnails', (event) => {
    observedValue = event.detail.newValue;
  });

  configWrite('upgradeThumbnails', false);
  assert.equal(observedValue, false);
  assert.equal(configRead('upgradeThumbnails'), false);
});

test('configuration rejects unknown keys and non-boolean values', () => {
  assert.throws(() => configWrite('upgradeThumbnails', 'yes'), TypeError);
  assert.throws(() => configWrite('unknown', true), /unknown config key/);
});
