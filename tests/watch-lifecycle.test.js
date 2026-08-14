import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

import {
  installDOMGlobals,
  registerCSSModuleStub,
  waitForTimers
} from './helpers/dom-runtime.js';

registerCSSModuleStub();

test('watch follows player replacement, host removal and live configuration', async () => {
  const browser = new Window({ url: 'https://www.youtube.com/tv#/' });
  const restoreGlobals = installDOMGlobals(browser);
  browser.localStorage.setItem(
    'ytaf-configuration-v2',
    JSON.stringify({ showWatch: true })
  );

  const firstPlayer = browser.document.createElement('ytlr-watch-default');
  firstPlayer.setAttribute('hybridnavfocusable', 'false');
  browser.document.body.appendChild(firstPlayer);

  let watchModule;
  try {
    watchModule = await import('../src/watch.js');
    watchModule.installWatch();
    const { configWrite } = await import('../src/config.js');
    let watch = browser.document.querySelector('.webOs-watch');
    assert.ok(watch instanceof browser.HTMLElement);
    assert.match(watch.innerText, /^\d{1,2}:\d{2}/);
    assert.equal(watch.style.display, 'block');
    assert.equal(watch.style.pointerEvents, 'none');
    assert.equal(watch.style.zIndex, '999');

    firstPlayer.setAttribute('hybridnavfocusable', 'true');
    await waitForTimers(10);
    assert.equal(watch.style.display, 'none');

    const secondPlayer = browser.document.createElement('ytlr-watch-default');
    secondPlayer.setAttribute('hybridnavfocusable', 'false');
    firstPlayer.replaceWith(secondPlayer);
    await waitForTimers(150);
    assert.equal(watch.style.display, 'block');

    watch.remove();
    await waitForTimers(150);
    assert.equal(browser.document.body.contains(watch), true);

    configWrite('showWatch', false);
    assert.equal(browser.document.querySelector('.webOs-watch'), null);
    configWrite('showWatch', true);
    watch = browser.document.querySelector('.webOs-watch');
    assert.ok(watch instanceof browser.HTMLElement);

    watchModule.dispose();
    watchModule.dispose();
    assert.equal(browser.document.querySelector('.webOs-watch'), null);
    configWrite('showWatch', false);
    configWrite('showWatch', true);
    assert.equal(browser.document.querySelector('.webOs-watch'), null);
  } finally {
    watchModule?.dispose();
    restoreGlobals();
    await browser.close();
  }
});
