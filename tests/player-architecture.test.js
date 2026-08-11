import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

import { findCapablePlayer, isYTPlayer } from '../src/player_api/helpers.ts';
import { PlayerManager } from '../src/player_api/manager.ts';

function setRect(element, { left, top, width, height }) {
  element.getBoundingClientRect = () => ({
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height
  });
}

function addPlayerCapabilities(player) {
  let stateListener = null;
  const state = {
    isBuffering: false,
    isCued: false,
    isDomPaused: false,
    isEnded: false,
    isError: false,
    isOrWillBePlaying: false,
    isPaused: true,
    isPlaying: false,
    isSeeking: false,
    isUiSeeking: false,
    isUnstarted: false
  };
  let videoID = 'video-a';
  Object.assign(player, {
    getPlaybackQualityLabel: () => '1080p',
    getAvailableQualityData: () => [],
    setPlaybackQualityRange: () => undefined,
    getVideoData: () => ({ video_id: videoID }),
    getPlayerStateObject: () => state,
    isInline: () => false,
    getVideoStats: () => ({ el: 'leanback' })
  });
  const nativeAdd = player.addEventListener.bind(player);
  const nativeRemove = player.removeEventListener.bind(player);
  player.addEventListener = (name, listener, options) => {
    if (name === 'onStateChange') stateListener = listener;
    else nativeAdd(name, listener, options);
  };
  player.removeEventListener = (name, listener, options) => {
    if (name === 'onStateChange' && stateListener === listener) {
      stateListener = null;
    } else {
      nativeRemove(name, listener, options);
    }
  };
  return {
    state,
    emitState: () => stateListener?.call(player, 1),
    hasStateListener: () => stateListener !== null,
    setVideoID: (value) => {
      videoID = value;
    }
  };
}

test('player capability guard skips matching DOM placeholders', async () => {
  const window = new Window({ url: 'https://www.youtube.com/tv#/' });
  const placeholder = window.document.createElement('div');
  placeholder.className = 'html5-video-player';
  const capable = window.document.createElement('div');
  capable.className = 'html5-video-player';
  addPlayerCapabilities(capable);
  window.document.body.append(placeholder, capable);

  assert.equal(isYTPlayer(placeholder), false);
  assert.equal(isYTPlayer(capable), true);
  assert.equal(findCapablePlayer(window.document), capable);
  await window.close();
});

test('player capability guard supports legacy selector matching and non-iterable NodeLists', async () => {
  const window = new Window({ url: 'https://www.youtube.com/tv#/' });
  const capable = window.document.createElement('div');
  capable.className = 'html5-video-player';
  const legacyMatcher = capable.matches;
  Object.defineProperties(capable, {
    matches: { value: undefined, configurable: true },
    webkitMatchesSelector: { value: legacyMatcher, configurable: true }
  });
  addPlayerCapabilities(capable);
  window.document.body.appendChild(capable);

  const nonIterableRoot = {
    nodeType: 9,
    querySelectorAll() {
      return { 0: capable, length: 1 };
    }
  };

  assert.equal(isYTPlayer(capable), true);
  assert.equal(findCapablePlayer(nonIterableRoot), capable);
  await window.close();
});

test('player selection and active video use the same visible-media resolver', async () => {
  const window = new Window({ url: 'https://www.youtube.com/tv#/' });
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = window;
  globalThis.document = window.document;
  const backgroundPlayer = window.document.createElement('div');
  const foregroundPlayer = window.document.createElement('div');
  backgroundPlayer.className = 'html5-video-player';
  foregroundPlayer.className = 'html5-video-player';
  addPlayerCapabilities(backgroundPlayer);
  addPlayerCapabilities(foregroundPlayer);
  const backgroundVideo = window.document.createElement('video');
  const foregroundVideo = window.document.createElement('video');
  setRect(backgroundVideo, { left: 3000, top: 0, width: 1920, height: 1080 });
  setRect(foregroundVideo, { left: 0, top: 0, width: 640, height: 360 });
  backgroundPlayer.appendChild(backgroundVideo);
  foregroundPlayer.appendChild(foregroundVideo);
  window.document.body.append(backgroundPlayer, foregroundPlayer);
  const manager = new PlayerManager(backgroundPlayer);

  try {
    assert.equal(findCapablePlayer(window.document), foregroundPlayer);
    assert.equal(manager.player, foregroundPlayer);
    assert.equal(manager.activeVideo, foregroundVideo);
  } finally {
    manager.destroy();
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    await window.close();
  }
});

test('player selection never borrows another root video during transitions', async () => {
  const window = new Window({ url: 'https://www.youtube.com/tv#/' });
  const emptyPlayer = window.document.createElement('div');
  const activePlayer = window.document.createElement('div');
  emptyPlayer.className = 'html5-video-player';
  activePlayer.className = 'html5-video-player';
  addPlayerCapabilities(emptyPlayer);
  addPlayerCapabilities(activePlayer);
  const activeVideo = window.document.createElement('video');
  setRect(activeVideo, { left: 0, top: 0, width: 640, height: 360 });
  activePlayer.appendChild(activeVideo);
  window.document.body.append(emptyPlayer, activePlayer);

  assert.equal(findCapablePlayer(window.document), activePlayer);
  await window.close();
});

test('player manager snapshots reused state and starts an already-playing new video', async () => {
  const window = new Window({ url: 'https://www.youtube.com/tv#/' });
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = window;
  globalThis.document = window.document;
  const player = window.document.createElement('div');
  player.className = 'html5-video-player';
  const controls = addPlayerCapabilities(player);
  window.document.body.appendChild(player);
  const manager = new PlayerManager(player);
  let playbackStarts = 0;
  const videoIDs = [];
  manager.addEventListener('playbackStart', () => playbackStarts++);
  manager.addEventListener('newVideo', (event) => videoIDs.push(event.detail));

  try {
    controls.emitState();
    controls.state.isPlaying = true;
    controls.state.isPaused = false;
    controls.emitState();
    controls.setVideoID('video-b');
    controls.emitState();

    assert.deepEqual(videoIDs, ['video-a', 'video-b']);
    assert.equal(playbackStarts, 2);
  } finally {
    manager.destroy();
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    await window.close();
  }
});

test('player manager construction rolls back when scheduling fails', async () => {
  const window = new Window({ url: 'https://www.youtube.com/tv#/' });
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const player = window.document.createElement('div');
  player.className = 'html5-video-player';
  const controls = addPlayerCapabilities(player);
  window.document.body.appendChild(player);
  globalThis.window = {
    setInterval() {
      throw new Error('scheduler unavailable');
    },
    clearInterval() {}
  };
  globalThis.document = window.document;

  try {
    assert.throws(() => new PlayerManager(player), /scheduler unavailable/);
    assert.equal(controls.hasStateListener(), false);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    await window.close();
  }
});
