import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

import {
  installDOMGlobals,
  registerCSSModuleStub,
  waitForTimers
} from './helpers/dom-runtime.js';

registerCSSModuleStub();

test('disposing deferred features prevents later DOMContentLoaded activation', async () => {
  const browser = new Window({ url: 'https://www.youtube.com/tv#/' });
  const restoreGlobals = installDOMGlobals(browser);
  browser.localStorage.setItem(
    'ytaf-configuration-v2',
    JSON.stringify({ showWatch: true })
  );
  browser.document.body.remove();

  let watch;
  let screensaver;
  try {
    [watch, screensaver] = await Promise.all([
      import('../src/watch.js'),
      import('../src/screensaver-fix.ts')
    ]);
    watch.installWatch();
    screensaver.installScreensaverFix();
    watch.dispose();
    screensaver.dispose();

    const body = browser.document.createElement('body');
    body.className = 'WEB_PAGE_TYPE_WATCH';
    const video = browser.document.createElement('video');
    video.style.width = '321px';
    body.appendChild(video);
    browser.document.documentElement.appendChild(body);
    browser.document.dispatchEvent(
      new browser.Event('DOMContentLoaded', { bubbles: true })
    );
    await waitForTimers(80);

    assert.equal(browser.document.querySelector('.webOs-watch'), null);
    assert.equal(video.style.width, '321px');
  } finally {
    watch?.dispose();
    screensaver?.dispose();
    restoreGlobals();
    await browser.close();
  }
});
