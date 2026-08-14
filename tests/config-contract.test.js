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

  removeItem(key) {
    this.values.delete(key);
  }
}

globalThis.window = { localStorage: new MemoryStorage() };
globalThis.DocumentFragment = class extends EventTarget {};
globalThis.window.localStorage.setItem(
  'ytaf-configuration',
  JSON.stringify({ enableSponsorBlock: true, upgradeThumbnails: true })
);
globalThis.window.localStorage.setItem('ytaf-configuration-v2', '{broken');

const {
  configAddChangeListener,
  configGetDesc,
  configRead,
  configRemoveChangeListener,
  configWrite
} = await import('../src/config.js');

test('third-party SponsorBlock requests require explicit opt-in', () => {
  assert.equal(configRead('enableSponsorBlock'), false);
  assert.equal(configRead('upgradeThumbnails'), true);
  assert.equal(
    globalThis.window.localStorage.getItem('ytaf-configuration'),
    null
  );
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
  assert.throws(() => configRead('unknown'), /unknown config key/);
  assert.throws(() => configGetDesc('unknown'), /unknown config key/);
});

test('configuration rolls back failed persistence and removes listeners', () => {
  const listener = () => assert.fail('removed listener was called');
  configAddChangeListener('upgradeThumbnails', listener);
  configRemoveChangeListener('upgradeThumbnails', listener);

  const storage = globalThis.window.localStorage;
  const originalSetItem = storage.setItem;
  storage.setItem = () => {
    throw new Error('quota exceeded');
  };
  const previous = configRead('upgradeThumbnails');
  try {
    assert.throws(
      () => configWrite('upgradeThumbnails', !previous),
      /failed to persist/
    );
    assert.equal(configRead('upgradeThumbnails'), previous);
  } finally {
    storage.setItem = originalSetItem;
  }

  assert.match(configGetDesc('upgradeThumbnails'), /thumbnail/i);
});
