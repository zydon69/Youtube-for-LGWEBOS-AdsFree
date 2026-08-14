import assert from 'node:assert/strict';
import test from 'node:test';

test('launcher entry normalizes launch data before navigating', async () => {
  const previousWindow = globalThis.window;
  const assignments = [];
  globalThis.window = {
    launchParams: JSON.stringify({ contentTarget: 'v=entry-video' }),
    location: { assign: (value) => assignments.push(value) }
  };
  try {
    await import('../src/index.js');
    assert.equal(assignments.length, 1);
    const target = new URL(assignments[0]);
    assert.equal(target.origin, 'https://www.youtube.com');
    assert.equal(target.pathname, '/tv');
    assert.equal(target.searchParams.get('v'), 'entry-video');
  } finally {
    globalThis.window = previousWindow;
  }
});
