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

const { configAddChangeListener, configRead, configWrite } =
  await import('../src/config.js');

test('configuration changes expose the new boolean value', () => {
  let observedValue;
  configAddChangeListener('upgradeThumbnails', (event) => {
    observedValue = event.detail.newValue;
  });

  configWrite('upgradeThumbnails', true);
  assert.equal(observedValue, true);
  assert.equal(configRead('upgradeThumbnails'), true);
});

test('configuration rejects unknown keys and non-boolean values', () => {
  assert.throws(() => configWrite('upgradeThumbnails', 'yes'), TypeError);
  assert.throws(() => configWrite('unknown', true), /unknown config key/);
});
