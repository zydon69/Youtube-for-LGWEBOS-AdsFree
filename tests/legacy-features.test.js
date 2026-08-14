import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

import {
  acquireTransactionalOwnership,
  InlineStyleOwner
} from '../src/core/inline-style-owner.js';
import { waitForChildAdd } from '../src/utils.js';

test('owned state rolls back if its observer subscription fails', () => {
  let visibleState = false;
  assert.throws(
    () =>
      acquireTransactionalOwnership({
        apply: () => {
          visibleState = true;
          return true;
        },
        subscribe: () => {
          throw new Error('observer unavailable');
        },
        notify: () => assert.fail('notification must not run'),
        rollback: () => {
          visibleState = false;
        }
      }),
    /observer unavailable/
  );
  assert.equal(visibleState, false);
});

test('inline ownership restores the latest intermediate host value', async () => {
  const browser = new Window();
  const element = browser.document.createElement('div');
  element.style.filter = 'contrast(2)';
  const owner = new InlineStyleOwner(element, ['filter']);
  owner.set('filter', 'brightness(0)');
  element.style.filter = 'sepia(1)';
  owner.set('filter', 'brightness(0)');
  owner.restore();
  assert.equal(element.style.filter, 'sepia(1)');

  const delayedOwner = new InlineStyleOwner(element, ['filter']);
  element.style.filter = 'hue-rotate(20deg)';
  delayedOwner.set('filter', 'brightness(0)');
  delayedOwner.restore();
  assert.equal(element.style.filter, 'hue-rotate(20deg)');
  await browser.close();
});

test('DOM waiting rejects predicate failures and disconnects exactly once', async () => {
  const previousObserver = globalThis.MutationObserver;
  let observerCallback;
  let disconnectCalls = 0;
  let predicateCalls = 0;
  globalThis.MutationObserver = class {
    constructor(callback) {
      observerCallback = callback;
    }

    observe() {}

    disconnect() {
      disconnectCalls++;
    }
  };

  try {
    const parent = { childNodes: [] };
    const target = { childNodes: [], failPredicate: true };
    const pending = waitForChildAdd(
      parent,
      (node) => {
        predicateCalls++;
        if (node.failPredicate) throw new Error('predicate failed');
        return false;
      },
      { timeoutMs: 100 }
    );
    observerCallback([{ type: 'childList', addedNodes: [target] }]);
    await assert.rejects(pending, /predicate failed/);
    assert.equal(disconnectCalls, 1);
    const callsAfterFailure = predicateCalls;
    observerCallback([{ type: 'childList', addedNodes: [target] }]);
    assert.equal(predicateCalls, callsAfterFailure);
  } finally {
    globalThis.MutationObserver = previousObserver;
  }
});

test('DOM mutation delivery is bounded and survives body replacement', async () => {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    MutationObserver: globalThis.MutationObserver
  };
  const browser = new Window();
  globalThis.window = browser;
  globalThis.document = browser.document;
  globalThis.MutationObserver = browser.MutationObserver;
  const documentRef = browser.document;

  const { subscribeDOMMutations, disconnectDOMMutationCoordinator } =
    await import('../src/core/dom-mutations.js');
  try {
    const deliveries = [];
    subscribeDOMMutations(
      (records, metadata) => deliveries.push({ records, metadata }),
      { maxPendingRecords: 2 }
    );
    for (let index = 0; index < 10; index++) {
      documentRef.body.appendChild(documentRef.createElement('div'));
    }
    await new Promise((resolve) => browser.setTimeout(resolve, 20));
    assert.equal(deliveries[0].records.length, 2);
    assert.equal(deliveries[0].metadata.overflowed, true);

    const replacementBody = documentRef.createElement('body');
    documentRef.documentElement.replaceChild(replacementBody, documentRef.body);
    replacementBody.appendChild(documentRef.createElement('span'));
    await new Promise((resolve) => browser.setTimeout(resolve, 20));
    assert.ok(deliveries.length >= 2);
    assert.equal(deliveries.at(-1).records.at(-1).target, replacementBody);
  } finally {
    disconnectDOMMutationCoordinator();
    await browser.close();
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.MutationObserver = previous.MutationObserver;
  }
});

test('legacy DOMRect converts setters and exposes modern helpers', async () => {
  const previousSelf = globalThis.self;
  const legacyGlobal = {};
  globalThis.self = legacyGlobal;
  try {
    await import(`../src/domrect-polyfill.js?test=${Date.now()}`);
    const Rect = legacyGlobal.DOMRect;
    const rect = new Rect('1', '2', '3', '4');
    rect.x = '5';
    rect.width = '-2';
    assert.equal(rect.x, 5);
    assert.equal(rect.width, -2);
    assert.equal(rect.left, 3);
    assert.deepEqual(Rect.fromRect({ x: '7', height: '8' }).toJSON(), {
      x: 7,
      y: 0,
      width: 0,
      height: 8,
      top: 0,
      right: 7,
      bottom: 8,
      left: 7
    });
  } finally {
    globalThis.self = previousSelf;
  }
});

test('thumbnail queue times out stalled images and preserves URL data', async () => {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    MutationObserver: globalThis.MutationObserver,
    Image: globalThis.Image,
    HTMLElement: globalThis.HTMLElement
  };
  const browser = new Window({ url: 'https://www.youtube.com/tv' });
  browser.localStorage.setItem(
    'ytaf-configuration-v2',
    JSON.stringify({ upgradeThumbnails: true })
  );
  for (let index = 0; index < 5; index++) {
    const thumbnail = browser.document.createElement('ytlr-thumbnail-details');
    thumbnail.style.backgroundImage = `url("https://i.ytimg.com/vi/video${index}/hqdefault.jpg")`;
    browser.document.body.appendChild(thumbnail);
  }

  const scheduled = new Map();
  let nextTimer = 0;
  const nativeSetTimeout = browser.setTimeout.bind(browser);
  const nativeClearTimeout = browser.clearTimeout.bind(browser);
  browser.setTimeout = (callback, delay) => {
    const token = ++nextTimer;
    scheduled.set(token, { callback, delay });
    return token;
  };
  browser.clearTimeout = (token) => scheduled.delete(token);

  class StalledImage {
    static instances = [];
    width = 0;
    height = 0;
    naturalHeight = 0;
    onload = null;
    onerror = null;

    constructor() {
      StalledImage.instances.push(this);
    }

    set src(value) {
      this.currentSrc = value;
    }
  }
  globalThis.window = browser;
  globalThis.document = browser.document;
  globalThis.MutationObserver = browser.MutationObserver;
  globalThis.Image = StalledImage;
  globalThis.HTMLElement = browser.HTMLElement;

  try {
    const module = await import('../src/thumbnail-quality.ts?test=stalled');
    module.installThumbnailQuality();
    const webpTimeout = [...scheduled.entries()].find(
      ([, task]) => task.delay === 1_500
    );
    assert.ok(webpTimeout);
    scheduled.delete(webpTimeout[0]);
    webpTimeout[1].callback();
    assert.equal(StalledImage.instances.length, 5);

    const firstLoadTimeout = [...scheduled.entries()].find(
      ([, task]) => task.delay === 8_000
    );
    assert.ok(firstLoadTimeout);
    scheduled.delete(firstLoadTimeout[0]);
    firstLoadTimeout[1].callback();
    assert.equal(StalledImage.instances.length, 6);

    const source = new URL(
      'https://i.ytimg.com/vi/abc_123/hqdefault.jpg?token=kept'
    );
    assert.equal(
      module.rewriteThumbnailURL(source, true).href,
      'https://i.ytimg.com/vi_webp/abc_123/sddefault.webp?token=kept'
    );
    assert.equal(
      module.rewriteThumbnailURL(
        new URL('https://i1.ytimg.com/vi/abc/hqdefault.jpg'),
        true
      ),
      null
    );
    assert.equal(
      module.rewriteThumbnailURL(
        new URL('https://i.ytimg.com:444/vi/abc/hqdefault.jpg'),
        true
      ),
      null
    );
    assert.equal(
      module.rewriteThumbnailURL(
        new URL('https://user:secret@i.ytimg.com/vi/abc/hqdefault.jpg'),
        true
      ),
      null
    );
    module.dispose();
  } finally {
    browser.setTimeout = nativeSetTimeout;
    browser.clearTimeout = nativeClearTimeout;
    await browser.close();
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.MutationObserver = previous.MutationObserver;
    globalThis.Image = previous.Image;
    globalThis.HTMLElement = previous.HTMLElement;
  }
});

test('thumbnail startup cleans constructor/src failures and rolls back observer failure', async () => {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    MutationObserver: globalThis.MutationObserver,
    Image: globalThis.Image,
    HTMLElement: globalThis.HTMLElement
  };
  const browser = new Window({ url: 'https://www.youtube.com/tv' });
  globalThis.window = browser;
  globalThis.document = browser.document;
  globalThis.HTMLElement = browser.HTMLElement;

  let timerCount = 0;
  const activeTimers = new Set();
  const nativeSetTimeout = browser.setTimeout.bind(browser);
  const nativeClearTimeout = browser.clearTimeout.bind(browser);
  browser.setTimeout = () => {
    timerCount++;
    activeTimers.add(timerCount);
    return timerCount;
  };
  browser.clearTimeout = (token) => activeTimers.delete(token);

  class ThrowingSourceImage {
    onload = null;
    onerror = null;

    set src(_value) {
      throw new Error('image source unavailable');
    }
  }

  globalThis.Image = ThrowingSourceImage;
  globalThis.MutationObserver = browser.MutationObserver;

  class ThrowingImage {
    constructor() {
      throw new Error('image constructor unavailable');
    }
  }

  try {
    const sourceFailureModule =
      await import('../src/thumbnail-quality.ts?test=source-failure');
    sourceFailureModule.installThumbnailQuality();
    assert.equal(activeTimers.size, 0);
    sourceFailureModule.dispose();

    let observerConstructions = 0;
    class FailingMutationObserver {
      constructor() {
        observerConstructions++;
        if (observerConstructions === 2) {
          throw new Error('observer unavailable');
        }
      }

      observe() {}

      disconnect() {}
    }
    globalThis.Image = ThrowingImage;
    globalThis.MutationObserver = FailingMutationObserver;
    const observerFailureModule =
      await import('../src/thumbnail-quality.ts?test=observer-failure');
    assert.throws(
      () => observerFailureModule.installThumbnailQuality(),
      /observer unavailable/
    );
    assert.equal(activeTimers.size, 0);
  } finally {
    browser.setTimeout = nativeSetTimeout;
    browser.clearTimeout = nativeClearTimeout;
    const { disconnectDOMMutationCoordinator } =
      await import('../src/core/dom-mutations.js');
    disconnectDOMMutationCoordinator();
    await browser.close();
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.MutationObserver = previous.MutationObserver;
    globalThis.Image = previous.Image;
    globalThis.HTMLElement = previous.HTMLElement;
  }
});
