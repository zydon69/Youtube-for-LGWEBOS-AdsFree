import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { PlayerManager, PlayerMode } from '../src/player_api/manager.ts';
import {
  VideoQualityController,
  isQualityPlayer
} from '../src/core/video-quality-controller.ts';
import { installDOMGlobals } from './helpers/dom-runtime.js';

class Scheduler {
  intervals = new Map();
  timeouts = new Map();
  token = 0;
  setInterval(callback) {
    this.intervals.set(++this.token, callback);
    return this.token;
  }
  clearInterval(token) {
    this.intervals.delete(token);
  }
  setTimeout(callback) {
    this.timeouts.set(++this.token, callback);
    return this.token;
  }
  clearTimeout(token) {
    this.timeouts.delete(token);
  }
  poll() {
    for (const callback of [...this.intervals.values()]) callback();
  }
}

function addPlayer(browser, videoID) {
  const player = browser.document.createElement('div');
  player.className = 'html5-video-player';
  const video = browser.document.createElement('video');
  video.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 640,
    bottom: 360,
    width: 640,
    height: 360
  });
  player.appendChild(video);
  browser.document.body.appendChild(player);
  const calls = [];
  const state = { id: videoID, preview: false, playing: true, quality: '720p' };
  Object.assign(player, {
    getVideoData: () => ({ video_id: state.id }),
    getPlayerStateObject: () => ({ isPlaying: state.playing }),
    isInline: () => state.preview,
    getPlaybackQualityLabel: () => state.quality,
    getAvailableQualityData: () => [
      { isPlayable: true, qualityLabel: '1080p' },
      { isPlayable: true, qualityLabel: '720p' }
    ],
    setPlaybackQualityRange: (...range) => calls.push(range)
  });
  return {
    player,
    video,
    state,
    calls,
    emit: () => player.dispatchEvent(new browser.Event('onStateChange'))
  };
}

async function scenario(run) {
  const browser = new Window();
  const restore = installDOMGlobals(browser);
  const first = addPlayer(browser, 'video-first');
  const manager = new PlayerManager(first.player);
  const scheduler = new Scheduler();
  const notifications = [];
  const warnings = [];
  const controller = new VideoQualityController(
    {
      read() {
        manager.synchronizePlayer();
        const player = manager.player;
        if (!isQualityPlayer(player))
          throw new Error('quality capability unavailable');
        return {
          player,
          videoID: manager.currentVideoID,
          preview: manager.playerMode === PlayerMode.PREVIEW
        };
      }
    },
    {
      scheduler,
      notify: (message) => notifications.push(message),
      warn: (message) => warnings.push(message)
    }
  );
  manager.addEventListener('newVideo', () => controller.handleNewVideo());
  manager.addEventListener('playbackStart', () =>
    controller.handlePlaybackStart()
  );
  try {
    await run({
      browser,
      first,
      manager,
      scheduler,
      notifications,
      warnings,
      controller
    });
  } finally {
    controller.dispose();
    manager.destroy();
    restore();
    await browser.close();
  }
}

test('root replacement observed during confirmation owns exactly one new quality operation', () =>
  scenario(
    ({ browser, first, manager, controller, scheduler, notifications }) => {
      controller.setEnabled(true);
      const oldPoll = [...scheduler.intervals.values()][0];
      const oldTimeout = [...scheduler.timeouts.values()][0];
      const replacement = addPlayer(browser, 'video-second');
      first.player.remove();
      scheduler.poll();
      assert.equal(manager.player, replacement.player);
      assert.deepEqual(first.calls, [
        ['highres', 'highres'],
        ['auto', 'auto']
      ]);
      assert.deepEqual(replacement.calls, [['highres', 'highres']]);
      assert.equal(scheduler.intervals.size, 1);
      oldPoll();
      oldTimeout();
      assert.equal(scheduler.intervals.size, 1);
      replacement.state.quality = '1080p';
      scheduler.poll();
      replacement.emit();
      replacement.emit();
      assert.equal(notifications.length, 1);
      assert.equal(scheduler.intervals.size + scheduler.timeouts.size, 0);
      controller.setEnabled(false);
      assert.deepEqual(replacement.calls.at(-1), ['auto', 'auto']);
    }
  ));

test('preview transition releases forced quality and normal playback reacquires it', () =>
  scenario(({ first, controller, scheduler }) => {
    controller.setEnabled(true);
    first.state.quality = '1080p';
    scheduler.poll();
    first.state.id = 'preview-video';
    first.state.preview = true;
    first.emit();
    assert.deepEqual(first.calls, [
      ['highres', 'highres'],
      ['auto', 'auto']
    ]);
    assert.equal(scheduler.intervals.size + scheduler.timeouts.size, 0);
    first.state.id = 'normal-video';
    first.state.preview = false;
    first.emit();
    assert.deepEqual(first.calls.at(-1), ['highres', 'highres']);
    assert.equal(scheduler.intervals.size, 1);
  }));

test('unknown metadata suspends quality writes until actual player identity appears', () =>
  scenario(({ first, controller, scheduler }) => {
    first.state.id = undefined;
    controller.setEnabled(true);
    assert.deepEqual(first.calls, []);
    assert.equal(scheduler.intervals.size + scheduler.timeouts.size, 0);
    first.state.id = 'confirmed-video';
    first.emit();
    assert.deepEqual(first.calls, [['highres', 'highres']]);
    assert.equal(scheduler.intervals.size, 1);
  }));

test('a synchronous player state emission while forcing quality does not duplicate operations', () =>
  scenario(({ first, controller, scheduler, notifications }) => {
    const write = first.player.setPlaybackQualityRange;
    first.player.setPlaybackQualityRange = (...args) => {
      write(...args);
      first.emit();
    };
    // Seed current video identity so the synchronous callback reflects a repeated
    // observation, rather than a new-video transition requiring a fresh write.
    first.emit();
    controller.setEnabled(true);
    assert.deepEqual(first.calls, [['highres', 'highres']]);
    assert.equal(scheduler.intervals.size, 1);
    first.state.quality = '1080p';
    scheduler.poll();
    assert.equal(notifications.length, 1);
    controller.setEnabled(false);
    assert.deepEqual(first.calls.at(-1), ['auto', 'auto']);
    assert.equal(scheduler.intervals.size + scheduler.timeouts.size, 0);
  }));

test('an unconfirmed forced range is released when quality metadata cannot be read', () =>
  scenario(({ first, controller, scheduler }) => {
    controller.setEnabled(true);
    first.player.getPlaybackQualityLabel = () => {
      throw new Error('quality metadata unavailable');
    };
    controller.setEnabled(false);
    assert.deepEqual(first.calls, [
      ['highres', 'highres'],
      ['auto', 'auto']
    ]);
    assert.equal(scheduler.intervals.size + scheduler.timeouts.size, 0);
  }));

test('quality confirmation does not announce a video replaced during capability reads', () =>
  scenario(({ first, controller, scheduler, notifications }) => {
    controller.setEnabled(true);
    first.state.quality = '1080p';
    first.player.getAvailableQualityData = () => {
      first.state.id = 'next-video';
      return [{ isPlayable: true, qualityLabel: '1080p' }];
    };
    scheduler.poll();
    assert.equal(notifications.length, 0);
    first.emit();
    scheduler.poll();
    assert.equal(notifications.length, 1);
  }));
