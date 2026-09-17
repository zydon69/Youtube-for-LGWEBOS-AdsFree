/* global window, document */
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('language migration persists one canonical PREF, preserves preferences and host commands', async ({
  page,
  context
}) => {
  await page.route('https://www.youtube.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<main></main>' })
  );
  await page.goto('https://www.youtube.com/tv/');
  await context.addCookies([
    {
      name: 'PREF',
      value: 'hl=fr&f6=400',
      domain: '.youtube.com',
      path: '/',
      secure: true
    },
    {
      name: 'PREF',
      value: 'hl=de&theme=dark',
      domain: 'www.youtube.com',
      path: '/',
      secure: true
    },
    {
      name: 'PREF',
      value: 'hl=it&volume=20',
      domain: 'www.youtube.com',
      path: '/tv',
      secure: true
    }
  ]);
  await page.evaluate(() => {
    window.__calls = [];
    window.__commands = {
      resolveCommand(payload) {
        window.__calls.push(payload);
      }
    };
    window.__originalResolve = window.__commands.resolveCommand;
    const Command = function () {};
    Command.instance = window.__commands;
    window._yttv = { Command };
    window.fetch = async () => new Response('[]');
    window.__hostNavigate = () => 'host';
    window.navigate = window.__hostNavigate;
    window.__spatialNavigation__ = Object.freeze({ keyMode: 'ARROW' });
    // Older TV engines provide appendChild but no Element.append.
    window.Element.prototype.append = undefined;
    window.Element.prototype.webkitMatchesSelector =
      window.Element.prototype.matches;
    window.Element.prototype.matches = undefined;
  });
  const bundle = await readFile('dist/webOSUserScripts/userScript.js', 'utf8');
  await page.addScriptTag({ content: bundle });
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__commands.resolveCommand !== window.__originalResolve
      )
    )
    .toBe(true);
  await page.evaluate(() =>
    window.__commands.resolveCommand({
      sibling: 'keep',
      setClientSettingEndpoint: {
        settingDatas: [
          { clientSettingEnum: { item: 'I18N_LANGUAGE' }, stringValue: 'es' }
        ]
      }
    })
  );
  expect(await page.evaluate(() => window.__calls)).toEqual([
    { sibling: 'keep' },
    { signalAction: { signal: 'RELOAD_PAGE' } }
  ]);
  const cookies = (await context.cookies()).filter(
    (cookie) => cookie.name === 'PREF'
  );
  expect(cookies).toHaveLength(1);
  expect(cookies[0].domain).toBe('.youtube.com');
  expect(cookies[0].path).toBe('/');
  const prefs = new URLSearchParams(cookies[0].value);
  expect(Object.fromEntries(prefs)).toEqual({
    hl: 'es',
    volume: '20',
    f6: '400',
    theme: 'dark'
  });
  expect(
    await page.evaluate(
      () =>
        window.navigate === window.__hostNavigate &&
        window.__spatialNavigation__.keyMode === 'ARROW'
    )
  ).toBe(true);
  await page.evaluate(() => window.ytaf_showOptionsPanel(true));
  const inputs = page.locator('.ytaf-ui-container input');
  await inputs.nth(0).locator('..').click();
  await page.keyboard.press('ArrowDown');
  await expect(inputs.nth(1)).toBeFocused();
  const count = await inputs.count();
  await Array.from({ length: count - 1 }).reduce(
    (sequence) => sequence.then(() => page.keyboard.press('ArrowDown')),
    Promise.resolve()
  );
  await expect(inputs.last()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(inputs.first()).toBeFocused();
  await page.evaluate(() => {
    const fieldset = document.createElement('fieldset');
    fieldset.disabled = true;
    fieldset.appendChild(document.createElement('input'));
    document.querySelector('.ytaf-ui-container').appendChild(fieldset);
  });
  await page.keyboard.press('Shift+Tab');
  await expect(inputs.nth(count - 1)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(inputs.first()).toBeFocused();
  await page.evaluate(() =>
    document.querySelector('.ytaf-ui-container').remove()
  );
  await expect(page.locator('.ytaf-ui-container')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.ytaf-ui-container')).toBeHidden();
});
