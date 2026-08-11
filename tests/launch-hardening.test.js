import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLaunchURL, parseLaunchParams } from '../src/core/launch.js';

test('partial launch targets cannot replace trusted runtime parameters', () => {
  const url = buildLaunchURL({
    target: 'q=webOS&env_enableVoice=0&launch=remote&vs=0&vq=unexpected'
  });

  assert.equal(url.searchParams.get('q'), 'webOS');
  assert.equal(url.searchParams.get('env_enableVoice'), '1');
  assert.equal(url.searchParams.has('launch'), false);
  assert.equal(url.searchParams.has('vs'), false);
  assert.equal(url.searchParams.has('vq'), false);
});

test('direct launch targets reject credentials and malformed app hashes', () => {
  for (const target of [
    'https://user@www.youtube.com/tv#/watch?v=video',
    'https://www.youtube.com/tv#unexpected'
  ]) {
    const url = buildLaunchURL({ contentTarget: target });
    assert.equal(url.href, buildLaunchURL({}).href);
  }
});

test('direct launch targets are bounded and force required defaults', () => {
  const tooMany = new URL('https://www.youtube.com/tv#/watch?v=video');
  for (let index = 0; index < 65; index++) {
    tooMany.searchParams.append(`p${index}`, 'value');
  }
  assert.equal(
    buildLaunchURL({ contentTarget: tooMany.href }).href,
    buildLaunchURL({}).href
  );

  const normalized = buildLaunchURL({
    contentTarget:
      'https://www.youtube.com/tv?env_enableVoice=0&feature=voice#/watch?v=video'
  });
  assert.equal(normalized.searchParams.get('env_enableVoice'), '1');
  assert.equal(normalized.searchParams.get('feature'), 'voice');
  assert.equal(normalized.hash, '#/watch?v=video');
});

test('launch parsing isolates hostile host objects', () => {
  const previousWarn = console.warn;
  console.warn = () => undefined;
  try {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('host getter failed');
        }
      }
    );
    assert.deepEqual(parseLaunchParams(hostile), {});
    assert.equal(buildLaunchURL(hostile).origin, 'https://www.youtube.com');
  } finally {
    console.warn = previousWarn;
  }
});
