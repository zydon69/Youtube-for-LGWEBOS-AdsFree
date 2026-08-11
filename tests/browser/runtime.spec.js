/* global window, document, PageTransitionEvent */
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('production entry preserves the native DOMRect implementation', async ({
  page
}) => {
  const bundle = await readFile('dist/webOSUserScripts/userScript.js', 'utf8');
  await page.route('https://www.youtube.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<main></main>' })
  );
  await page.goto('https://www.youtube.com/tv#/');
  await page.evaluate(() => {
    window.__nativeDOMRect = window.DOMRect;
    window.__nativeJSONParse = window.JSON.parse;
    window.__nativeFetch = async () =>
      new Response('[]', {
        headers: { 'content-length': '2' }
      });
    window.fetch = window.__nativeFetch;
    window._yttv = {};
  });
  await page.evaluate((source) => {
    const script = document.createElement('script');
    script.textContent = source;
    document.head.appendChild(script);
  }, bundle);

  await expect.poll(() => page.locator('.ytaf-ui-container').count()).toBe(1);
  expect(
    await page.evaluate(() => window.DOMRect === window.__nativeDOMRect)
  ).toBe(true);
  await expect(page.locator('.ytaf-ui-container')).toHaveAttribute(
    'role',
    'dialog'
  );

  expect(
    await page.evaluate(() => {
      const hookedFetch = window.fetch;
      const hookedParse = window.JSON.parse;
      window.dispatchEvent(
        new PageTransitionEvent('pagehide', { persisted: true })
      );
      return window.fetch === hookedFetch && window.JSON.parse === hookedParse;
    })
  ).toBe(true);
  expect(
    await page.evaluate(() => {
      window.dispatchEvent(
        new PageTransitionEvent('pagehide', { persisted: false })
      );
      return (
        window.fetch === window.__nativeFetch &&
        window.JSON.parse === window.__nativeJSONParse
      );
    })
  ).toBe(true);
});
