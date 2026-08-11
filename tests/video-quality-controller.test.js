import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getMaxQualityLabel,
  VideoQualityController
} from '../src/core/video-quality-controller.ts';

class ManualScheduler {
  nextToken = 1;
  intervals = new Map();
  timeouts = new Map();

  setInterval(callback) {
    const token = this.nextToken++;
    this.intervals.set(token, callback);
    return token;
  }

  clearInterval(token) {
    this.intervals.delete(token);
  }

  setTimeout(callback) {
    const token = this.nextToken++;
    this.timeouts.set(token, callback);
    return token;
  }

  clearTimeout(token) {
    this.timeouts.delete(token);
  }

  runIntervals() {
    for (const callback of [...this.intervals.values()]) callback();
  }

  runNextTimeout() {
    const next = this.timeouts.entries().next().value;
    assert.ok(next, 'expected a scheduled timeout');
    const [token, callback] = next;
    this.timeouts.delete(token);
    callback();
  }
}

function createPlayer(initialQuality = '720p') {
  let selectedQuality = initialQuality;
  const rangeCalls = [];
  return {
    rangeCalls,
    get selectedQuality() {
      return selectedQuality;
    },
    set selectedQuality(value) {
      selectedQuality = value;
    },
    getPlaybackQualityLabel: () => selectedQuality,
    getAvailableQualityData: () => [
      { isPlayable: true, qualityLabel: '720p' },
      { isPlayable: false, qualityLabel: '4320p' },
      { isPlayable: true, qualityLabel: '4K' },
      { isPlayable: true, qualityLabel: '1080p' }
    ],
    setPlaybackQualityRange: (...args) => rangeCalls.push(args)
  };
}

function createHarness(player = createPlayer()) {
  const scheduler = new ManualScheduler();
  const notifications = [];
  const warnings = [];
  const state = { player, videoID: 'video-1', preview: false };
  const controller = new VideoQualityController(
    {
      getPlayer: () => state.player,
      getVideoID: () => state.videoID,
      isPreview: () => state.preview
    },
    {
      scheduler,
      notify: (...args) => notifications.push(args),
      warn: (...args) => warnings.push(args),
      pollIntervalMs: 1,
      settleTimeoutMs: 10,
      retryDelayMs: 1,
      maxAttempts: 3
    }
  );
  return { controller, notifications, scheduler, state, warnings };
}

test('quality ranking chooses the highest playable label without sorting host data', () => {
  const player = createPlayer();
  const before = player.getAvailableQualityData();
  assert.equal(getMaxQualityLabel(player), '4K');
  assert.deepEqual(player.getAvailableQualityData(), before);
});

test('quality application recovers after an API failure', () => {
  const player = createPlayer();
  const originalSet = player.setPlaybackQualityRange;
  let attempts = 0;
  player.setPlaybackQualityRange = (...args) => {
    attempts++;
    if (attempts === 1) throw new Error('player not ready');
    originalSet(...args);
  };
  const harness = createHarness(player);

  harness.controller.setEnabled(true);
  assert.equal(attempts, 1);
  assert.equal(harness.warnings.length, 1);
  harness.scheduler.runNextTimeout();
  assert.equal(attempts, 2);
  assert.deepEqual(player.rangeCalls, [['highres', 'highres']]);
});

test('quality polling ignores intermediate variations and confirms the target', () => {
  const player = createPlayer('480p');
  const harness = createHarness(player);
  harness.controller.setEnabled(true);

  player.selectedQuality = '720p';
  harness.scheduler.runIntervals();
  assert.equal(harness.notifications.length, 0);

  player.selectedQuality = '4K';
  harness.scheduler.runIntervals();
  assert.equal(harness.notifications.length, 1);
  assert.match(harness.notifications[0][0], /4K selected/);
  assert.equal(harness.scheduler.intervals.size, 0);
  assert.equal(harness.scheduler.timeouts.size, 0);
});

test('disabling preserves host overrides and does nothing without ownership', () => {
  const player = createPlayer('480p');
  const harness = createHarness(player);
  harness.state.preview = true;
  harness.controller.setEnabled(true);
  harness.controller.setEnabled(false);
  assert.deepEqual(player.rangeCalls, []);

  harness.state.preview = false;
  harness.controller.setEnabled(true);
  assert.deepEqual(player.rangeCalls, [['highres', 'highres']]);
  player.selectedQuality = '720p';
  harness.controller.setEnabled(false);
  assert.deepEqual(player.rangeCalls, [['highres', 'highres']]);
});

test('disabling releases an owned quality range and replacement players are isolated', () => {
  const firstPlayer = createPlayer('480p');
  const harness = createHarness(firstPlayer);
  harness.controller.setEnabled(true);
  firstPlayer.selectedQuality = '4K';

  const secondPlayer = createPlayer('720p');
  harness.state.player = secondPlayer;
  harness.state.videoID = 'video-2';
  harness.controller.handleNewVideo();
  assert.deepEqual(secondPlayer.rangeCalls, [['highres', 'highres']]);
  assert.deepEqual(firstPlayer.rangeCalls, [
    ['highres', 'highres'],
    ['auto', 'auto']
  ]);

  secondPlayer.selectedQuality = '4K';
  harness.controller.setEnabled(false);
  assert.deepEqual(secondPlayer.rangeCalls, [
    ['highres', 'highres'],
    ['auto', 'auto']
  ]);
});

test('new-video retries preserve same-player ownership for later cleanup', () => {
  const player = createPlayer('480p');
  const harness = createHarness(player);
  harness.controller.setEnabled(true);
  player.selectedQuality = '4K';
  harness.scheduler.runIntervals();

  harness.state.videoID = 'video-2';
  player.selectedQuality = '720p';
  player.setPlaybackQualityRange = () => {
    throw new Error('new video API unavailable');
  };
  harness.controller.handleNewVideo();
  player.setPlaybackQualityRange = (...args) => player.rangeCalls.push(args);
  player.selectedQuality = '4K';
  harness.controller.setEnabled(false);

  assert.deepEqual(player.rangeCalls, [
    ['highres', 'highres'],
    ['auto', 'auto']
  ]);
});

test('quality controller disposal is idempotent and releases owned state', () => {
  const player = createPlayer('480p');
  const harness = createHarness(player);
  harness.controller.setEnabled(true);
  player.selectedQuality = '4K';

  harness.controller.dispose();
  harness.controller.dispose();
  harness.controller.handlePlaybackStart();

  assert.deepEqual(player.rangeCalls, [
    ['highres', 'highres'],
    ['auto', 'auto']
  ]);
  assert.equal(harness.scheduler.intervals.size, 0);
  assert.equal(harness.scheduler.timeouts.size, 0);
});
