import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';

const window = new Window({
  url: 'https://www.youtube.com/tv#/',
  settings: { disableJavaScriptEvaluation: false }
});
Object.defineProperty(window, 'EventTarget', {
  configurable: true,
  value: undefined
});
Object.defineProperty(window, 'CustomEvent', {
  configurable: true,
  value: undefined
});
/** @type {string[]} */
const networkRequests = [];
/** @type {typeof window.fetch} */
const nativeFetch = async (resource) => {
  const url =
    resource instanceof window.Request ? resource.url : String(resource);
  networkRequests.push(url);
  const body = url.includes('sponsor.ajay.app')
    ? JSON.stringify([
        {
          videoID: 'smoke-video',
          segments: [{ category: 'sponsor', segment: [10, 20] }]
        }
      ])
    : '[]';
  return new window.Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
};
window.fetch = nativeFetch;
const nativeJSONParse = window.JSON.parse;

/** @type {Array<{ command: Record<string, unknown>, extra: unknown }>} */
const resolveCalls = [];
function commandTarget() {}
/** @this {Record<string, unknown>} @param {Record<string, unknown>} command @param {unknown} extra */
function nativeResolveCommand(command, extra) {
  assert.equal(this, commandInstance);
  resolveCalls.push({ command, extra });
  return command;
}
const commandInstance = {
  resolveCommand: nativeResolveCommand
};
commandTarget.instance = commandInstance;
Object.defineProperty(window, '_yttv', {
  configurable: true,
  value: { commandTarget }
});

/** @type {unknown[][]} */
const qualitySelections = [];
/** @param {unknown[]} args */
function recordQualitySelection(...args) {
  qualitySelections.push(args);
}
const player = window.document.createElement('div');
player.className = 'html5-video-player';
Object.assign(player, {
  getPlaybackQualityLabel: () => '720p',
  getAvailableQualityData: () => [
    { isPlayable: true, qualityLabel: '720p' },
    { isPlayable: true, qualityLabel: '1080p' }
  ],
  setPlaybackQualityRange: recordQualitySelection,
  getVideoData: () => ({ video_id: 'smoke-video' }),
  getPlayerStateObject: () => ({ isPlaying: false }),
  isInline: () => false,
  getVideoStats: () => ({ el: 'leanback' })
});
window.document.body.appendChild(player);

function createVideo() {
  const video = window.document.createElement('video');
  Object.defineProperties(video, {
    paused: { configurable: true, value: false },
    duration: { configurable: true, value: 120 },
    currentTime: { configurable: true, value: 0, writable: true }
  });
  return video;
}

const initialVideo = createVideo();
const initialControls = window.document.createElement('div');
initialControls.setAttribute('idomkey', 'controls');
window.document.body.append(initialVideo, initialControls);

/** @param {any} panel @param {string} description */
function findCheckbox(panel, description) {
  return Array.from(panel.querySelectorAll('label'))
    .find((label) => label.textContent?.includes(description))
    ?.querySelector('input');
}

/** @param {any} checkbox @param {boolean} checked */
function dispatchCheckboxChange(checkbox, checked) {
  assert.ok(checkbox, 'expected settings checkbox');
  checkbox.checked = checked;
  checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));
}

function dispatchBlueKey() {
  const event = new window.KeyboardEvent('keydown', { bubbles: true });
  Object.defineProperties(event, {
    charCode: { configurable: true, value: 406 },
    keyCode: { configurable: true, value: 406 }
  });
  window.document.dispatchEvent(event);
}

try {
  const bundle = await readFile('dist/webOSUserScripts/userScript.js', 'utf8');
  assert.equal(bundle.includes('__ytaf_debug__'), false);
  // This isolated test executes only the locally built, integrity-checked bundle.
  window.eval(bundle);
  await new Promise((resolve) => window.setTimeout(resolve, 100));

  const panel = window.document.querySelector('.ytaf-ui-container');
  assert.ok(panel, 'settings panel was not created');
  assert.equal(panel.getAttribute('role'), 'dialog');
  assert.equal(panel.querySelector('h1')?.textContent, 'YouTube AdFree');

  const sponsorCheckbox = findCheckbox(panel, 'Enable SponsorBlock');
  assert.equal(sponsorCheckbox?.checked, false);
  assert.equal(
    networkRequests.length,
    0,
    'disabled integrations made a request'
  );
  commandInstance.resolveCommand({ smokeCommand: {} }, 'smoke-extra');
  assert.deepEqual(resolveCalls, [
    { command: { smokeCommand: {} }, extra: 'smoke-extra' }
  ]);

  await assert.rejects(
    window.fetch('https://www.youtube.com/wake_cast_core'),
    /Failed to fetch/
  );
  assert.equal(
    networkRequests.length,
    0,
    'blocked cast request reached network'
  );

  await window.fetch('https://www.youtube.com/tv');
  assert.deepEqual(networkRequests, ['https://www.youtube.com/tv']);

  const qualityCheckbox = findCheckbox(panel, 'Force max resolution');
  dispatchCheckboxChange(qualityCheckbox, true);
  await new Promise((resolve) => window.setTimeout(resolve, 20));
  assert.deepEqual(qualitySelections.at(-1), ['highres', 'highres']);

  window.location.hash = '/watch?v=smoke-video';
  dispatchCheckboxChange(sponsorCheckbox, true);
  await new Promise((resolve) => window.setTimeout(resolve, 100));
  assert.ok(
    networkRequests.some((url) =>
      url.startsWith('https://sponsor.ajay.app/api/')
    ),
    'SponsorBlock opt-in did not reach the official endpoint'
  );

  dispatchBlueKey();
  await new Promise((resolve) => window.setTimeout(resolve, 20));
  assert.equal(initialVideo.style.visibility, 'hidden');
  assert.ok(
    initialControls.querySelector('.ytaf-ui-watchControl-overlayMessage')
  );

  const nativeQuerySelector = window.document.querySelector.bind(
    window.document
  );
  let controlQueries = 0;
  window.document.querySelector = (/** @type {string} */ selector) => {
    if (selector === '[idomkey="controls"]') controlQueries++;
    return nativeQuerySelector(selector);
  };
  await Promise.all(
    Array.from(
      { length: 5 },
      (_, index) =>
        new Promise((resolve) =>
          window.setTimeout(() => {
            window.document.body.appendChild(
              window.document.createElement('span')
            );
            resolve(undefined);
          }, index * 5)
        )
    )
  );
  await new Promise((resolve) => window.setTimeout(resolve, 70));
  assert.ok(
    controlQueries <= 2,
    `DOM synchronization ran ${controlQueries} times`
  );
  window.document.querySelector = nativeQuerySelector;

  const replacementVideo = createVideo();
  const replacementControls = window.document.createElement('div');
  replacementControls.setAttribute('idomkey', 'controls');
  initialVideo.replaceWith(replacementVideo);
  initialControls.replaceWith(replacementControls);
  await new Promise((resolve) => window.setTimeout(resolve, 120));
  assert.equal(initialVideo.style.visibility, '');
  assert.equal(replacementVideo.style.visibility, 'hidden');
  assert.ok(
    replacementControls.querySelector('.ytaf-ui-watchControl-overlayMessage')
  );

  dispatchBlueKey();
  await new Promise((resolve) => window.setTimeout(resolve, 20));
  assert.equal(replacementVideo.style.visibility, '');
  assert.equal(
    replacementControls.querySelector('.ytaf-ui-watchControl-overlayMessage'),
    null
  );

  assert.notEqual(window.fetch, nativeFetch);
  assert.notEqual(commandInstance.resolveCommand, nativeResolveCommand);
  window.dispatchEvent(new window.Event('pagehide'));
  assert.equal(window.fetch, nativeFetch);
  assert.equal(window.JSON.parse, nativeJSONParse);
  assert.equal(commandInstance.resolveCommand, nativeResolveCommand);
  console.info('Production bundle smoke test passed');
} finally {
  await window.close();
}

// Some legacy-polyfill timers are intentionally long-lived in production.
// The isolated smoke-test process has completed all assertions at this point.
process.exit(0);
