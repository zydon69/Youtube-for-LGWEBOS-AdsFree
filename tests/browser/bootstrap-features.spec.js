/* global window, document, PageTransitionEvent */
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function startFixture(page, configuration) {
  await page.route('**/*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<main>Initial account page</main>'
    })
  );
  await page.goto('https://www.youtube.com/tv#/');
  await page.evaluate((config) => {
    localStorage.setItem('ytaf-configuration-v2', JSON.stringify(config));
    window.__report = null;
    window.__commands = [];
    window.__ranges = [];
    window.DOMRect = undefined;
    window.CustomEvent = undefined;
    window.Element.prototype.append = undefined;
    window.Intl = undefined;
    document.addEventListener('ytafBootstrapComplete', (event) => {
      window.__report = event.detail;
    });
    const CommandTarget = function () {};
    CommandTarget.instance = {
      resolveCommand(command) {
        window.__commands.push(command);
        return command;
      }
    };
    window._yttv = { CommandTarget };
  }, configuration);
  await page.addScriptTag({
    content: await readFile('dist/webOSUserScripts/userScript.js', 'utf8')
  });
  await expect.poll(() => page.evaluate(() => window.__report)).not.toBeNull();
  expect(await page.evaluate(() => window.__report.failures)).toEqual([]);
}

async function addPlayer(page) {
  await page.evaluate(() => {
    const player = document.createElement('div');
    player.className = 'html5-video-player';
    const video = document.createElement('video');
    video.style.cssText = 'width:640px;height:360px';
    player.appendChild(video);
    let quality = '1080p';
    Object.assign(player, {
      getVideoData: () => ({ video_id: 'late-video' }),
      getPlayerStateObject: () => ({ isPlaying: true }),
      getPlaybackQualityLabel: () => quality,
      getAvailableQualityData: () => [
        { isPlayable: true, qualityLabel: '1080p' }
      ],
      setPlaybackQualityRange(minimum, maximum) {
        window.__ranges.push([minimum, maximum]);
        quality = minimum === 'highres' ? '1080p' : 'auto';
      },
      isInline: () => false
    });
    document.body.appendChild(player);
  });
}

for (const forceHighResVideo of [false, true]) {
  for (const autoAccountSelect of [false, true]) {
    test(`startup remains independent: quality=${forceHighResVideo}, account=${autoAccountSelect}`, async ({
      page
    }) => {
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await startFixture(page, {
        forceHighResVideo,
        autoAccountSelect,
        showWatch: true,
        upgradeThumbnails: true
      });
      const report = await page.evaluate(() => window.__report);
      expect(report.loaded).toContain('language-settings');
      expect(report.loaded).toContain('block-webos-cast');
      expect(report.loaded).toContain('auto-account-select');
      expect(await page.evaluate(() => window.DOMRect)).toBeUndefined();
      await expect(page.locator('.webOs-watch')).toHaveText(/^\d{2}:\d{2}$/);
      const result = await page.evaluate(() => {
        const command = {
          startAccountSelectorCommand: {
            nextEndpoint: { browseEndpoint: { browseId: 'home' } }
          }
        };
        const target = window._yttv.CommandTarget.instance;
        return [target.resolveCommand(command), target.resolveCommand(command)];
      });
      expect(Boolean(result[0].onIdentityChanged)).toBe(autoAccountSelect);
      expect(result[1].startAccountSelectorCommand).toBeDefined();
      await addPlayer(page);
      if (forceHighResVideo) {
        await expect
          .poll(() => page.evaluate(() => window.__ranges))
          .toEqual([['highres', 'highres']]);
        await expect(
          page.locator('.ytaf-notification-container')
        ).toContainText('1080p selected');
      }
      await page.evaluate(() =>
        window.dispatchEvent(
          new PageTransitionEvent('pagehide', { persisted: false })
        )
      );
      expect(await page.evaluate(() => window.__ranges)).toEqual(
        forceHighResVideo
          ? [
              ['highres', 'highres'],
              ['auto', 'auto']
            ]
          : []
      );
      await expect(page.locator('.ytaf-ui-container')).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }
}

for (const stop of ['disable', 'dispose']) {
  test(`a late player cannot reactivate quality after ${stop}`, async ({
    page
  }) => {
    await startFixture(page, {
      forceHighResVideo: true,
      autoAccountSelect: true
    });
    if (stop === 'disable') {
      await page.evaluate(() => window.ytaf_showOptionsPanel(true));
      await page
        .getByLabel('Force max resolution video playback', { exact: true })
        .uncheck();
    } else {
      await page.evaluate(() =>
        window.dispatchEvent(
          new PageTransitionEvent('pagehide', { persisted: false })
        )
      );
    }
    await addPlayer(page);
    // The deferred player probe is capped at 500 ms; observe beyond that deadline.
    await page.waitForTimeout(650);
    expect(await page.evaluate(() => window.__ranges)).toEqual([]);
    if (stop === 'disable') {
      await page
        .getByLabel('Force max resolution video playback', { exact: true })
        .check();
      await expect
        .poll(() => page.evaluate(() => window.__ranges))
        .toEqual([['highres', 'highres']]);
    }
  });
}
