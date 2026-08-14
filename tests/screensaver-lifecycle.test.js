import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

import { installDOMGlobals, waitForTimers } from './helpers/dom-runtime.js';

test('screensaver sizing follows watch state and restores the latest host styles', async () => {
  const browser = new Window({ url: 'https://www.youtube.com/tv#/' });
  const restoreGlobals = installDOMGlobals(browser);
  browser.innerWidth = 1280;
  browser.innerHeight = 720;
  browser.document.body.classList.add('WEB_PAGE_TYPE_WATCH');

  const firstVideo = browser.document.createElement('video');
  firstVideo.style.cssText =
    'width: 640px; height: 360px; left: 12px; top: 8px;';
  browser.document.body.appendChild(firstVideo);

  let module;
  try {
    module = await import('../src/screensaver-fix.ts');
    module.installScreensaverFix();
    assert.equal(firstVideo.style.width, '1280px');
    assert.equal(firstVideo.style.height, '720px');
    assert.equal(firstVideo.style.left, '0px');
    assert.equal(firstVideo.style.top, '0px');

    firstVideo.style.width = '777px';
    await waitForTimers(70);
    assert.equal(firstVideo.style.width, '1280px');

    firstVideo.hidden = true;
    await waitForTimers(70);
    assert.equal(firstVideo.style.width, '777px');
    assert.equal(firstVideo.style.height, '360px');

    firstVideo.style.width = '555px';
    firstVideo.hidden = false;
    await waitForTimers(70);
    assert.equal(firstVideo.style.width, '1280px');

    const hiddenAncestor = browser.document.createElement('section');
    firstVideo.replaceWith(hiddenAncestor);
    hiddenAncestor.appendChild(firstVideo);
    hiddenAncestor.style.display = 'none';
    await waitForTimers(110);
    assert.equal(firstVideo.style.width, '555px');
    hiddenAncestor.style.display = 'block';
    await waitForTimers(70);
    assert.equal(firstVideo.style.width, '1280px');

    browser.innerWidth = 1024;
    browser.innerHeight = 576;
    browser.dispatchEvent(new browser.Event('resize'));
    await waitForTimers(70);
    assert.equal(firstVideo.style.width, '1024px');
    assert.equal(firstVideo.style.height, '576px');

    const replacementBody = browser.document.createElement('body');
    replacementBody.className = 'WEB_PAGE_TYPE_WATCH';
    const secondVideo = browser.document.createElement('video');
    secondVideo.style.cssText =
      'width: 320px; height: 180px; left: 4px; top: 6px;';
    replacementBody.appendChild(secondVideo);
    browser.document.documentElement.replaceChild(
      replacementBody,
      browser.document.body
    );
    await waitForTimers(90);
    assert.equal(firstVideo.style.width, '555px');
    assert.equal(secondVideo.style.width, '1024px');
    assert.equal(secondVideo.style.height, '576px');

    replacementBody.classList.remove('WEB_PAGE_TYPE_WATCH');
    await waitForTimers(70);
    assert.equal(secondVideo.style.width, '320px');
    replacementBody.classList.add('WEB_PAGE_TYPE_WATCH');
    await waitForTimers(70);
    assert.equal(secondVideo.style.width, '1024px');

    module.dispose();
    module.dispose();
    assert.equal(secondVideo.style.width, '320px');
    assert.equal(secondVideo.style.height, '180px');
    assert.equal(secondVideo.style.left, '4px');
    assert.equal(secondVideo.style.top, '6px');

    secondVideo.style.width = '444px';
    browser.innerWidth = 800;
    browser.dispatchEvent(new browser.Event('resize'));
    await waitForTimers(70);
    assert.equal(secondVideo.style.width, '444px');
  } finally {
    module?.dispose();
    restoreGlobals();
    await browser.close();
  }
});
