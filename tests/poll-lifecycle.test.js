import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { startPolling, pollUntil } from '../src/core/poll.js';
import {
  getPlayerManager,
  destroyPlayerManager
} from '../src/player_api/manager.ts';
import { installDOMGlobals } from './helpers/dom-runtime.js';

function scheduler() {
  let token = 0;
  const timers = new Map();
  return {
    timers,
    setTimeout(callback, delay) {
      timers.set(++token, { callback, delay });
      return token;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    next() {
      const entry = timers.entries().next().value;
      assert.ok(entry, 'scheduled work expected');
      const [id, task] = entry;
      timers.delete(id);
      task.callback();
    }
  };
}

test('owned polling cancellation rejects once and stale callbacks never probe or rearm', async () => {
  const clock = scheduler();
  let probes = 0;
  const lookup = startPolling(
    () => {
      probes++;
      return null;
    },
    { scheduler: clock }
  );
  const stale = [...clock.timers.values()][0].callback;
  lookup.cancel();
  lookup.cancel();
  await assert.rejects(lookup.promise, { name: 'AbortError' });
  stale();
  assert.equal(probes, 1);
  assert.equal(clock.timers.size, 0);
});

test('aborting synchronously during the probe cannot schedule after rejection', async () => {
  const clock = scheduler();
  const controller = new AbortController();
  let probes = 0;
  const lookup = startPolling(
    () => {
      probes++;
      controller.abort();
      return null;
    },
    { scheduler: clock, signal: controller.signal }
  );
  await assert.rejects(lookup.promise, { name: 'AbortError' });
  assert.equal(probes, 1);
  assert.equal(clock.timers.size, 0);
});

test('a successful polling operation ignores later cancellation and stale delivery', async () => {
  const clock = scheduler();
  let probes = 0;
  const lookup = startPolling(() => (++probes === 2 ? 0 : null), {
    scheduler: clock
  });
  const stale = [...clock.timers.values()][0].callback;
  clock.next();
  assert.equal(await lookup.promise, 0);
  lookup.cancel();
  stale();
  assert.equal(probes, 2);
  assert.equal(clock.timers.size, 0);
});

test('scheduler failures during a later retry reject the polling promise', async () => {
  const clock = scheduler();
  const lookup = startPolling(() => null, { scheduler: clock });
  clock.setTimeout = () => {
    throw new Error('scheduler unavailable');
  };
  clock.next();
  await assert.rejects(lookup.promise, /scheduler unavailable/);
  assert.equal(clock.timers.size, 0);
});

test('retry delay is clipped to the remaining timeout budget', async (context) => {
  let now = 0;
  context.mock.method(Date, 'now', () => now);
  const clock = scheduler();
  const pending = pollUntil(() => null, {
    scheduler: clock,
    timeoutMs: 60,
    initialDelayMs: 50,
    maxDelayMs: 100
  });
  assert.equal([...clock.timers.values()][0].delay, 50);
  now = 50;
  clock.next();
  assert.equal([...clock.timers.values()][0].delay, 10);
  now = 60;
  clock.next();
  await assert.rejects(pending, /timed out after 60ms/);
  assert.equal(clock.timers.size, 0);
});

test('manager shutdown without AbortController cancels pending lookup and permits a fresh generation', async () => {
  const browser = new Window();
  const restore = installDOMGlobals(browser);
  const nativeAbortController = globalThis.AbortController;
  const clock = scheduler();
  browser.setTimeout = clock.setTimeout;
  browser.clearTimeout = clock.clearTimeout;
  globalThis.AbortController = undefined;
  destroyPlayerManager();
  try {
    const first = getPlayerManager();
    const cancelled = assert.rejects(first, { name: 'AbortError' });
    const stale = [...clock.timers.values()][0].callback;
    destroyPlayerManager();
    assert.equal(clock.timers.size, 0);
    const second = getPlayerManager();
    const coalesced = getPlayerManager();
    stale();
    assert.equal(clock.timers.size, 1);
    await cancelled;
    const player = browser.document.createElement('div');
    player.className = 'html5-video-player';
    Object.assign(player, {
      getVideoData: () => ({ video_id: 'next-video' }),
      getPlayerStateObject: () => ({ isPlaying: false })
    });
    browser.document.body.appendChild(player);
    clock.next();
    const manager = await second;
    assert.equal(manager.player === player, true);
    assert.equal(await coalesced, manager);
    assert.equal(clock.timers.size, 0);
  } finally {
    destroyPlayerManager();
    globalThis.AbortController = nativeAbortController;
    restore();
    await browser.close();
  }
});
