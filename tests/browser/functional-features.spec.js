/* global window, document, PageTransitionEvent */
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('legacy TV APIs keep settings, clock and screen-hidden functional', async ({
  page
}) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const bundle = await readFile('dist/webOSUserScripts/userScript.js', 'utf8');
  await page.route('https://www.youtube.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `
        <div class="html5-video-player">
          <video style="display:block;width:640px;height:360px"></video>
          <div idomkey="controls"></div>
        </div>
        <ytlr-watch-default hybridnavfocusable="false"></ytlr-watch-default>
      `
    })
  );
  await page.goto('https://www.youtube.com/tv#/watch?v=legacy01');
  await page.evaluate(() => {
    window.__ytafBootstrapResult = null;
    document.addEventListener(
      'ytafBootstrapComplete',
      (event) => {
        window.__ytafBootstrapResult = event.detail;
      },
      { once: true }
    );
    localStorage.setItem(
      'ytaf-configuration-v2',
      JSON.stringify({ showWatch: true })
    );
    window.fetch = async () =>
      new Response('[]', { headers: { 'content-length': '2' } });
    window._yttv = {};
    window.Element.prototype.prepend = undefined;
    window.Element.prototype.matches = undefined;
    Object.defineProperty(window.Node.prototype, 'isConnected', {
      configurable: true,
      value: undefined
    });
    window.Intl = undefined;
  });
  await page.evaluate((source) => {
    const script = document.createElement('script');
    script.textContent = source;
    document.head.appendChild(script);
  }, bundle);

  await expect.poll(() => page.locator('.ytaf-ui-container').count()).toBe(1);
  await expect
    .poll(() => page.evaluate(() => window.__ytafBootstrapResult))
    .not.toBeNull();
  expect(
    await page.evaluate(() => window.__ytafBootstrapResult.failures)
  ).toEqual([]);
  expect(pageErrors).toEqual([]);
  await expect(page.locator('.webOs-watch')).toHaveText(/^\d{2}:\d{2}$/);

  const versionContrast = await page
    .locator('.ytaf-ui-version')
    .evaluate((element) => {
      const parse = (value) =>
        value
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number)
          .map((channel) => {
            const normalized = channel / 255;
            return normalized <= 0.04045
              ? normalized / 12.92
              : ((normalized + 0.055) / 1.055) ** 2.4;
          });
      const luminance = ([red, green, blue]) =>
        0.2126 * red + 0.7152 * green + 0.0722 * blue;
      const foreground = luminance(
        parse(window.getComputedStyle(element).color)
      );
      const background = luminance(
        [18, 18, 18].map((value) => {
          const normalized = value / 255;
          return ((normalized + 0.055) / 1.055) ** 2.4;
        })
      );
      return (foreground + 0.05) / (background + 0.05);
    });
  expect(versionContrast).toBeGreaterThanOrEqual(4.5);

  const pressRemoteKey = (code, repeat = false) =>
    page.evaluate(
      ({ keyCode, isRepeat }) => {
        const event = new window.KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          repeat: isRepeat
        });
        Object.defineProperty(event, 'keyCode', { value: keyCode });
        Object.defineProperty(event, 'charCode', { value: keyCode });
        document.dispatchEvent(event);
      },
      { keyCode: code, isRepeat: repeat }
    );

  await pressRemoteKey(404);
  await expect(page.locator('.ytaf-ui-container')).toBeVisible();
  await pressRemoteKey(404, true);
  await expect(page.locator('.ytaf-ui-container')).toBeVisible();
  await pressRemoteKey(404);
  await expect(page.locator('.ytaf-ui-container')).toBeHidden();

  await pressRemoteKey(406);
  await expect(page.locator('video')).toHaveCSS('visibility', 'hidden');
  await expect(
    page.locator('.ytaf-ui-watchControl-overlayMessage')
  ).toHaveCount(1);
  await pressRemoteKey(406);
  await expect(page.locator('video')).not.toHaveCSS('visibility', 'hidden');
  await expect(
    page.locator('.ytaf-ui-watchControl-overlayMessage')
  ).toHaveCount(0);

  await page.evaluate(() => {
    window.dispatchEvent(
      new window.PageTransitionEvent('pagehide', { persisted: false })
    );
  });
  await expect(page.locator('.ytaf-ui-container')).toHaveCount(0);
  await expect(page.locator('.webOs-watch')).toHaveCount(0);
});
