import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

test('spatial navigation exposes non-enumerable APIs and accepts zero coordinates', async () => {
  const browser = new Window({ url: 'https://www.youtube.com/tv' });
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    self: globalThis.self,
    Element: globalThis.Element,
    CustomEvent: globalThis.CustomEvent,
    DOMRect: globalThis.DOMRect
  };
  Object.assign(globalThis, {
    window: browser,
    document: browser.document,
    self: browser,
    Element: browser.Element,
    CustomEvent: browser.CustomEvent,
    DOMRect: browser.DOMRect
  });

  try {
    await import('../src/spatial-navigation-polyfill.js');

    for (const name of [
      'spatialNavigationSearch',
      'focusableAreas',
      'getSpatialNavigationContainer'
    ]) {
      const descriptor = Object.getOwnPropertyDescriptor(
        browser.Element.prototype,
        name
      );
      assert.equal(typeof descriptor?.value, 'function');
      assert.equal(descriptor?.enumerable, false);
    }

    let hitTests = 0;
    browser.document.elementFromPoint = () => {
      hitTests++;
      return browser.document.body;
    };
    browser.__spatialNavigation__.setStartingPoint(0, 0);
    browser.navigate('right');
    assert.equal(hitTests, 1);
  } finally {
    Object.assign(globalThis, previous);
    await browser.close();
  }
});
