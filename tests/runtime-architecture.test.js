import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

import { ActiveMediaResolver } from '../src/core/active-media-resolver.ts';
import {
  defineBootstrapModule,
  IsolatedBootstrap
} from '../src/core/isolated-bootstrap.ts';
import { isTrustedRuntimeContext } from '../src/core/runtime-context.ts';

test('runtime context requires the exact YouTube origin in the top frame', () => {
  const top = {};
  assert.equal(
    isTrustedRuntimeContext({
      self: top,
      top,
      location: { href: 'https://www.youtube.com/tv#/' }
    }),
    true
  );
  assert.equal(
    isTrustedRuntimeContext({
      self: {},
      top,
      location: { href: 'https://www.youtube.com/tv#/' }
    }),
    false
  );
  assert.equal(
    isTrustedRuntimeContext({
      self: top,
      top,
      location: { href: 'https://www.youtube.com.evil.example/tv' }
    }),
    false
  );
});

test('isolated bootstrap continues after failure and disposes in reverse order', async () => {
  const actions = [];
  const errors = [];
  const bootstrap = new IsolatedBootstrap({
    error(message, error) {
      errors.push([message, error]);
    }
  });
  const report = await bootstrap.run([
    defineBootstrapModule(
      'first',
      async () => {
        actions.push('load:first');
        return 'first-module';
      },
      (module) => actions.push('dispose:' + module)
    ),
    defineBootstrapModule('broken', async () => {
      actions.push('load:broken');
      throw new Error('broken feature');
    }),
    defineBootstrapModule(
      'last',
      async () => {
        actions.push('load:last');
        return 'last-module';
      },
      (module) => actions.push('dispose:' + module)
    )
  ]);

  assert.deepEqual(report.loaded, ['first', 'last']);
  assert.equal(report.failures.length, 1);
  assert.equal(errors.length, 1);
  bootstrap.dispose();
  bootstrap.dispose();
  assert.deepEqual(actions, [
    'load:first',
    'load:broken',
    'load:last',
    'dispose:last-module',
    'dispose:first-module'
  ]);
});

test('isolated bootstrap contains asynchronous disposer failures', async () => {
  const errors = [];
  const bootstrap = new IsolatedBootstrap({
    error(message, error) {
      errors.push([message, error]);
    }
  });
  await bootstrap.run([
    defineBootstrapModule(
      'async-disposer',
      async () => ({}),
      async () => {
        throw new Error('dispose failed');
      }
    )
  ]);

  bootstrap.dispose();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(errors.length, 1);
  assert.match(errors[0][0], /async-disposer/);
});

test('isolated bootstrap rolls back a module that finishes after disposal', async () => {
  let resolveLoad;
  const disposed = [];
  const bootstrap = new IsolatedBootstrap({ error() {} });
  const run = bootstrap.run([
    defineBootstrapModule(
      'late-module',
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
      (module) => disposed.push(module)
    )
  ]);
  await Promise.resolve();
  bootstrap.dispose();
  resolveLoad('late');

  const report = await run;
  assert.equal(report.aborted, true);
  assert.deepEqual(report.loaded, []);
  assert.deepEqual(disposed, ['late']);
});

test('isolated bootstrap rejects duplicate descriptors before side effects', async () => {
  let loadCalls = 0;
  const descriptor = defineBootstrapModule('duplicate', async () => {
    loadCalls++;
  });
  const bootstrap = new IsolatedBootstrap({ error() {} });

  await assert.rejects(bootstrap.run([descriptor, descriptor]), /Duplicate/);
  assert.equal(loadCalls, 0);
});

function setRect(element, { left, top, width, height }) {
  element.getBoundingClientRect = () => ({
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON() {
      return {};
    }
  });
}

test('active media resolution is root-aware, visible-area based and cross-realm safe', async () => {
  const window = new Window({ url: 'https://www.youtube.com/tv#/' });
  const { document } = window;
  const offscreen = document.createElement('video');
  const active = document.createElement('video');
  const rooted = document.createElement('video');
  const playerRoot = document.createElement('div');
  setRect(offscreen, { left: 2500, top: 0, width: 1920, height: 1080 });
  setRect(active, { left: 0, top: 0, width: 1280, height: 720 });
  setRect(rooted, { left: 0, top: 0, width: 320, height: 180 });
  document.body.append(offscreen, active, playerRoot);
  playerRoot.appendChild(rooted);

  const resolver = new ActiveMediaResolver(document);
  assert.equal(resolver.resolveVideo(), active);
  assert.equal(resolver.resolveVideo(playerRoot), rooted);
  active.style.display = 'none';
  assert.notEqual(resolver.resolveVideo(), active);
  await window.close();
});
