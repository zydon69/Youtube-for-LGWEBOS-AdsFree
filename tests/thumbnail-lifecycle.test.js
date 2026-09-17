import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { installDOMGlobals, waitForTimers } from './helpers/dom-runtime.js';

test('thumbnails inserted during detection, detached and recycled all re-enter the bounded queue', async () => {
  const browser = new Window({ url: 'https://www.youtube.com/tv' });
  const restore = installDOMGlobals(browser);
  const document = browser.document;
  const previousImage = globalThis.Image;
  class ControlledImage {
    static instances = [];
    width = 1;
    height = 1;
    naturalHeight = 360;
    onload = null;
    onerror = null;
    constructor() {
      ControlledImage.instances.push(this);
    }
    set src(value) {
      this.currentSrc = value;
    }
    removeAttribute() {}
  }
  globalThis.Image = ControlledImage;
  let module;
  try {
    const { configWrite } = await import('../src/config.js');
    configWrite('upgradeThumbnails', true);
    module = await import('../src/thumbnail-quality.ts?lifecycle');
    module.installThumbnailQuality();
    const thumbnail = document.createElement('ytlr-thumbnail-details');
    thumbnail.style.backgroundImage =
      'url("https://i.ytimg.com/vi/first/hqdefault.jpg")';
    document.body.appendChild(thumbnail);
    await waitForTimers(45);
    assert.equal(ControlledImage.instances.length, 1);
    ControlledImage.instances[0].onload();
    assert.equal(ControlledImage.instances.length, 2);
    const cancelledCompletion = ControlledImage.instances[1].onload;
    thumbnail.remove();
    await waitForTimers(45);
    cancelledCompletion();
    assert.match(thumbnail.style.backgroundImage, /hqdefault/);
    document.body.appendChild(thumbnail);
    await waitForTimers(45);
    assert.equal(ControlledImage.instances.length, 3);
    ControlledImage.instances[2].onload();
    assert.match(
      thumbnail.style.backgroundImage,
      /vi_webp\/first\/sddefault.webp/
    );
    thumbnail.remove();
    await waitForTimers(45);
    assert.match(thumbnail.style.backgroundImage, /hqdefault/);
    thumbnail.style.backgroundImage =
      'url("https://i.ytimg.com/vi/second/hqdefault.jpg")';
    document.body.appendChild(thumbnail);
    await waitForTimers(45);
    ControlledImage.instances.at(-1).onload();
    assert.match(
      thumbnail.style.backgroundImage,
      /vi_webp\/second\/sddefault.webp/
    );
    configWrite('upgradeThumbnails', false);
    assert.match(thumbnail.style.backgroundImage, /vi\/second\/hqdefault.jpg/);
    configWrite('upgradeThumbnails', true);
    const late = ControlledImage.instances.at(-1).onload;
    module.dispose();
    late();
    assert.match(thumbnail.style.backgroundImage, /hqdefault/);
  } finally {
    module?.dispose();
    globalThis.Image = previousImage;
    restore();
    await browser.close();
  }
});
