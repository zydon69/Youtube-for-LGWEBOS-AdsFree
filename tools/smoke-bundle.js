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
let externalRequests = 0;
window.fetch = async () => {
  externalRequests++;
  return new window.Response('[]', {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
};

try {
  const bundle = await readFile('dist/webOSUserScripts/userScript.js', 'utf8');
  // This isolated test executes only the locally built, integrity-checked bundle.
  window.eval(bundle);
  await new Promise((resolve) => window.setTimeout(resolve, 50));

  const panel = window.document.querySelector('.ytaf-ui-container');
  assert.ok(panel, 'settings panel was not created');
  assert.equal(panel.getAttribute('role'), 'dialog');
  assert.equal(panel.querySelector('h1')?.textContent, 'YouTube AdFree');

  const sponsorCheckbox = Array.from(panel.querySelectorAll('label'))
    .find((label) => label.textContent?.includes('Enable SponsorBlock'))
    ?.querySelector('input');
  assert.equal(sponsorCheckbox?.checked, false);
  assert.equal(
    externalRequests,
    0,
    'disabled integrations made a network request'
  );
  console.info('Production bundle smoke test passed');
} finally {
  await window.close();
}

// Some legacy-polyfill timers are intentionally long-lived in production.
// The isolated smoke-test process has completed all assertions at this point.
process.exit(0);
