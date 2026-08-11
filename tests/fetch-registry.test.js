/* global window */
import assert from 'node:assert/strict';
import test from 'node:test';

test('fetch registry blocks cancelled requests and restores the exact fetch', async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const nativeFetch = async () => new Response('{}');
  globalThis.window = { fetch: nativeFetch };
  globalThis.document = { location: { href: 'https://www.youtube.com/tv' } };

  try {
    const { FetchRegistry } = await import('../src/hooks/fetch.ts');
    const registry = FetchRegistry.getInstance();
    let observedResponse = false;
    registry.addEventListener('response', () => {
      observedResponse = true;
    });
    const response = await window.fetch('https://www.youtube.com/tv');
    assert.equal(await response.text(), '{}');
    assert.equal(observedResponse, true);

    registry.addEventListener('request', (event) => event.preventDefault());
    await assert.rejects(
      window.fetch('https://www.youtube.com/private'),
      /Failed to fetch/
    );
    registry.dispose();
    assert.equal(window.fetch, nativeFetch);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});
