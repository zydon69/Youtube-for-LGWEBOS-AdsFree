import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
  installDOMGlobals,
  registerCSSModuleStub
} from './helpers/dom-runtime.js';
import { setMediaPresentationHidden } from '../src/core/active-media-resolver.ts';
registerCSSModuleStub();

async function scenario(run) {
  const browser = new Window({ url: 'https://www.youtube.com/tv#/' });
  const restore = installDOMGlobals(browser);
  globalThis.__YTAF_VERSION__ = 'audit-test';
  const scheduled = new Map();
  let token = 0;
  browser.setTimeout = (callback, delay = 0) => {
    scheduled.set(++token, { callback, delay });
    return token;
  };
  browser.clearTimeout = (id) => scheduled.delete(id);
  const player = browser.document.createElement('div');
  const video = browser.document.createElement('video');
  player.appendChild(video);
  browser.document.body.appendChild(player);
  Object.defineProperties(video, {
    currentTime: { configurable: true, writable: true, value: 12 },
    duration: { configurable: true, writable: true, value: 120 },
    paused: { configurable: true, writable: true, value: false },
    seeking: { configurable: true, writable: true, value: false },
    ended: { configurable: true, writable: true, value: false }
  });
  const { SponsorBlockHandler, dispose } =
    await import('../src/sponsorblock.js');
  const handler = new SponsorBlockHandler('video12345', ['sponsor']);
  const manager = {
    currentVideoID: 'video12345',
    player,
    synchronizePlayer() {},
    removeEventListener() {}
  };
  handler.playerManager = manager;
  handler.rawSegments = [{ category: 'sponsor', segment: [10, 20] }];
  handler.synchronizeVideo();
  const notifications = new Set();
  const drain = (limit = 30) => {
    let count = 0;
    while (scheduled.size && count < limit) {
      const [id, item] = scheduled.entries().next().value;
      scheduled.delete(id);
      item.callback();
      for (const element of browser.document.querySelectorAll('.message')) {
        if (element.textContent === 'Skipping sponsored segment')
          notifications.add(element);
      }
      count++;
    }
    return count;
  };
  try {
    await run({
      browser,
      handler,
      manager,
      player,
      video,
      scheduled,
      drain,
      notifications
    });
  } finally {
    handler.destroy();
    dispose();
    delete globalThis.__YTAF_VERSION__;
    restore();
    await browser.close();
  }
}

for (const mode of [
  'throw',
  'ignore',
  'clamp-19.75',
  'clamp-19.8',
  'clamp-19.9',
  'clamp-19.949',
  'clamp-19.95',
  'synchronous-events'
]) {
  test(`SponsorBlock seek outcome ${mode} settles without loops or duplicate messages`, () =>
    scenario(({ browser, handler, video, drain, scheduled, notifications }) => {
      let time = 12;
      let writes = 0;
      Object.defineProperty(video, 'currentTime', {
        configurable: true,
        get: () => time,
        set: (value) => {
          writes++;
          if (mode === 'throw') throw new Error('seek rejected');
          if (mode === 'ignore') return;
          time = mode.startsWith('clamp-') ? Number(mode.slice(6)) : value;
          if (mode === 'synchronous-events')
            video.dispatchEvent(new browser.Event('timeupdate'));
        }
      });
      const previousWarn = console.warn;
      console.warn = () => {};
      try {
        assert.ok(drain() < 30);
      } finally {
        console.warn = previousWarn;
      }
      assert.equal(scheduled.size, 0);
      const successful =
        mode === 'clamp-19.95' || mode === 'synchronous-events';
      assert.equal(writes, successful ? 1 : 3);
      assert.equal(notifications.size, successful ? 1 : 0);
      assert.equal(handler.blockedSegments.size, successful ? 0 : 1);
    }));
}

for (const transition of [
  'unknown-id',
  'other-id',
  'replacement',
  'source',
  'paused',
  'seeking',
  'ended',
  'destroyed'
]) {
  test(`SponsorBlock cancels a queued seek after ${transition}`, () =>
    scenario(({ browser, handler, manager, player, video, scheduled }) => {
      const stale = [...scheduled.values()][0].callback;
      if (transition === 'unknown-id') manager.currentVideoID = null;
      if (transition === 'other-id') manager.currentVideoID = 'othervideo';
      if (transition === 'replacement') {
        video.remove();
        player.appendChild(browser.document.createElement('video'));
      }
      if (transition === 'source')
        video.src = 'https://example.com/replacement.mp4';
      if (transition === 'paused') video.paused = true;
      if (transition === 'seeking') video.seeking = true;
      if (transition === 'ended') video.ended = true;
      if (transition === 'destroyed') handler.destroy();
      stale();
      assert.equal(video.currentTime, 12);
      assert.equal(handler.pendingSeek, null);
    }));
}

test('SponsorBlock suspends unknown identity and resumes after metadata returns', () =>
  scenario(({ handler, manager, video }) => {
    manager.currentVideoID = null;
    handler.synchronizeVideo();
    assert.equal(handler.video, null);
    manager.currentVideoID = 'video12345';
    handler.synchronizeVideo();
    handler.executeScheduledSkip(handler.segments[0]);
    assert.equal(video.currentTime, 20);
  }));

test('screen-off presentation preserves SponsorBlock media identity', () =>
  scenario(({ handler, video }) => {
    setMediaPresentationHidden(video, true);
    video.style.visibility = 'hidden';
    handler.synchronizeVideo();
    handler.executeScheduledSkip(handler.segments[0]);
    assert.equal(video.currentTime, 20);
    video.style.visibility = '';
    setMediaPresentationHidden(video, false);
  }));

test('pause cancels pending confirmation and resume restarts a bounded seek', () =>
  scenario(({ browser, handler, video, scheduled }) => {
    let time = 12;
    let allow = false;
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => time,
      set: (value) => {
        if (allow) time = value;
      }
    });
    handler.executeScheduledSkip(handler.segments[0]);
    assert.ok(handler.pendingSeek);
    video.paused = true;
    video.dispatchEvent(new browser.Event('pause'));
    assert.equal(handler.pendingSeek, null);
    assert.equal(scheduled.size, 0);
    allow = true;
    video.paused = false;
    video.dispatchEvent(new browser.Event('play'));
    handler.executeScheduledSkip(handler.segments[0]);
    assert.equal(video.currentTime, 20);
  }));

test('duration truncation without an event cannot reschedule an unreachable segment end', () =>
  scenario(({ handler, video, drain }) => {
    video.duration = 15;
    assert.ok(drain() < 30);
    assert.equal(video.currentTime, 15);
    assert.equal(handler.nextSkipTimeout, null);
  }));

test('obsolete confirmation cannot fail a later seek for the same segment', () =>
  scenario(({ browser, handler, video, scheduled }) => {
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => 12,
      set: () => {}
    });
    handler.executeScheduledSkip(handler.segments[0]);
    const oldConfirmation = scheduled.get(
      handler.pendingSeek.timeoutToken
    ).callback;
    video.paused = true;
    video.dispatchEvent(new browser.Event('pause'));
    video.paused = false;
    video.dispatchEvent(new browser.Event('play'));
    handler.executeScheduledSkip(handler.segments[0]);
    const currentConfirmation = handler.pendingSeek.timeoutToken;
    oldConfirmation();
    assert.equal(handler.pendingSeek.timeoutToken, currentConfirmation);
    assert.equal(handler.seekAttempts.size, 0);
  }));

test('seeking backwards rearms a previously exhausted segment after leaving its range', () =>
  scenario(({ browser, handler, video, drain }) => {
    let time = 12;
    let allow = false;
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => time,
      set: (value) => {
        if (allow) time = value;
      }
    });
    const warn = console.warn;
    console.warn = () => {};
    try {
      assert.ok(drain() < 30);
    } finally {
      console.warn = warn;
    }
    assert.equal(handler.blockedSegments.size, 1);
    time = 5;
    video.dispatchEvent(new browser.Event('seeked'));
    assert.equal(handler.blockedSegments.size, 0);
    time = 12;
    allow = true;
    video.dispatchEvent(new browser.Event('timeupdate'));
    assert.ok(drain() < 30);
    assert.equal(time, 20);
  }));

test('a replacement media with missing identity remains untouched until confirmed', () =>
  scenario(({ browser, handler, manager, player, video }) => {
    const replacement = browser.document.createElement('video');
    Object.defineProperties(replacement, {
      currentTime: { configurable: true, writable: true, value: 12 },
      paused: { configurable: true, value: false },
      duration: { configurable: true, value: 120 }
    });
    video.remove();
    player.appendChild(replacement);
    manager.currentVideoID = null;
    handler.synchronizeVideo();
    assert.equal(handler.video, null);
    assert.equal(replacement.currentTime, 12);
    manager.currentVideoID = 'video12345';
    handler.synchronizeVideo();
    handler.executeScheduledSkip(handler.segments[0]);
    assert.equal(replacement.currentTime, 20);
  }));

test('emptied cancels old media work before its replacement is synchronized', () =>
  scenario(({ browser, handler, manager, video, scheduled }) => {
    const oldSeek = [...scheduled.values()][0].callback;
    video.dispatchEvent(new browser.Event('emptied'));
    manager.currentVideoID = null;
    oldSeek();
    assert.equal(video.currentTime, 12);
    assert.equal(handler.video, null);
  }));

test('segment overlay is rooted, duration-bounded, idempotent, and removed when segments disappear', () =>
  scenario(({ browser, handler, player, video }) => {
    const unrelatedProgress = browser.document.createElement('div');
    unrelatedProgress.setAttribute('idomkey', 'progress-bar');
    browser.document.body.appendChild(unrelatedProgress);
    handler.renderOverlay();
    assert.equal(unrelatedProgress.children.length, 0);
    const progress = browser.document.createElement('div');
    progress.setAttribute('idomkey', 'progress-bar');
    const slider = browser.document.createElement('div');
    slider.setAttribute('idomkey', 'slider');
    progress.appendChild(slider);
    player.appendChild(progress);
    video.duration = 40;
    handler.rawSegments = [
      { category: 'sponsor', segment: [10, 20] },
      { category: 'sponsor', segment: [30, 60] }
    ];
    video.dispatchEvent(new browser.Event('durationchange'));
    handler.renderOverlay();
    assert.equal(
      slider.querySelectorAll('.ytaf-sponsorblock-segment-container').length,
      1
    );
    assert.deepEqual(
      [...slider.querySelectorAll('.ytaf-sponsorblock-segment')].map(
        (element) => [element.style.left, element.style.width]
      ),
      [
        ['25%', '25%'],
        ['75%', '25%']
      ]
    );
    assert.equal(slider.classList.contains('ytaf-sponsorblock-active'), true);
    handler.rawSegments = [];
    video.dispatchEvent(new browser.Event('durationchange'));
    assert.equal(slider.children.length, 0);
    assert.equal(slider.classList.contains('ytaf-sponsorblock-active'), false);
    assert.equal(unrelatedProgress.children.length, 0);
  }));

test('delayed seek completion is observed at confirmation deadline even without media events', () =>
  scenario(({ handler, video, scheduled }) => {
    let time = 12;
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => time,
      set: () => {}
    });
    handler.executeScheduledSkip(handler.segments[0]);
    const confirmation = scheduled.get(
      handler.pendingSeek.timeoutToken
    ).callback;
    time = 20;
    confirmation();
    assert.equal(handler.pendingSeek, null);
    assert.equal(handler.seekAttempts.size, 0);
    assert.equal(handler.nextSkipTimeout, null);
  }));
