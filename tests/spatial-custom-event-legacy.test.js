import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

test('spatial navigation emits cancellable events without a CustomEvent constructor', async () => {
  const browser = new Window({ url: 'https://www.youtube.com/tv' });
  Object.defineProperty(browser, 'CustomEvent', {
    configurable: true,
    value: undefined,
    writable: true
  });
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
    CustomEvent: undefined,
    DOMRect: browser.DOMRect
  });

  try {
    await import('../src/spatial-navigation-polyfill.js');
    let observed;
    const handleNavigationEvent = (event) => {
      observed = event;
      event.preventDefault();
    };
    browser.document.body.addEventListener(
      'navnotarget',
      handleNavigationEvent
    );
    browser.document.documentElement.addEventListener(
      'navnotarget',
      handleNavigationEvent
    );

    assert.doesNotThrow(() => browser.navigate('right'));
    assert.equal(observed?.type, 'navnotarget');
    assert.equal(observed?.cancelable, true);
    assert.equal(observed?.defaultPrevented, true);
  } finally {
    Object.assign(globalThis, previous);
    await browser.close();
  }
});
