import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CustomEventTarget,
  TypedCustomEvent
} from '../src/custom-event-target.ts';
import { fetchSponsorBlockJSON } from '../src/core/sponsorblock-client.js';
import {
  MAX_SPONSORBLOCK_RESPONSE_BYTES,
  parseSponsorBlockResponse
} from '../src/core/sponsorblock-schema.js';

test('legacy event dispatcher supports cancellation without native EventTarget', () => {
  const target = new CustomEventTarget();
  let observed;
  const listener = (event) => {
    observed = event.detail;
    assert.equal(event.currentTarget, target);
    event.preventDefault();
  };

  target.addEventListener('change', listener);
  const allowed = target.dispatchEvent(
    new TypedCustomEvent('change', { detail: 42, cancelable: true })
  );
  target.removeEventListener('change', listener);

  assert.equal(observed, 42);
  assert.equal(allowed, false);
});

test('SponsorBlock client rejects non-retryable and oversized responses', async () => {
  let requests = 0;
  await assert.rejects(
    fetchSponsorBlockJSON('https://sponsor.ajay.app/api/test', async () => {
      requests++;
      return new Response('bad request', { status: 400 });
    }),
    /HTTP 400/
  );
  assert.equal(requests, 1);

  await assert.rejects(
    fetchSponsorBlockJSON(
      'https://sponsor.ajay.app/api/test',
      async () =>
        new Response('[]', {
          headers: {
            'content-length': String(MAX_SPONSORBLOCK_RESPONSE_BYTES + 1)
          }
        })
    ),
    /too large/
  );

  await assert.rejects(
    fetchSponsorBlockJSON(
      'https://sponsor.ajay.app/api/test',
      async () => new Response('x'.repeat(MAX_SPONSORBLOCK_RESPONSE_BYTES + 1))
    ),
    /too large/
  );

  let legacyTextRead = false;
  await assert.rejects(
    fetchSponsorBlockJSON('https://sponsor.ajay.app/api/test', async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: null,
      text: async () => {
        legacyTextRead = true;
        return '[]';
      }
    })),
    /size is unknown/
  );
  assert.equal(legacyTextRead, false);
});

test('SponsorBlock client honors cancellation before making a request', async () => {
  const controller = new AbortController();
  controller.abort();
  let requests = 0;
  await assert.rejects(
    fetchSponsorBlockJSON(
      'https://sponsor.ajay.app/api/test',
      async () => {
        requests++;
        return new Response('[]');
      },
      { signal: controller.signal }
    ),
    { name: 'AbortError' }
  );
  assert.equal(requests, 0);
});

test('SponsorBlock client parses bounded bodies and retries server failures', async () => {
  let requests = 0;
  const result = await fetchSponsorBlockJSON(
    'https://sponsor.ajay.app/api/test',
    async () => {
      requests++;
      if (requests === 1) return new Response('temporary', { status: 503 });
      const body = '[{"videoID":"video","segments":[]}]';
      return new Response(body, {
        headers: { 'content-length': String(body.length) }
      });
    }
  );

  assert.equal(requests, 2);
  assert.deepEqual(result, [{ videoID: 'video', segments: [] }]);
});

test('SponsorBlock schema searches bounded bodies, caps duration and duplicates', () => {
  const manyCandidates = Array.from({ length: 100 }, () => ({}));
  manyCandidates.push({
    videoID: 'video',
    segments: [{ category: 'sponsor', segment: [1, 2] }]
  });
  assert.deepEqual(parseSponsorBlockResponse(manyCandidates, 'video'), [
    { category: 'sponsor', segment: [1, 2] }
  ]);

  assert.deepEqual(
    parseSponsorBlockResponse(
      [
        {
          videoID: 'video',
          segments: [
            { category: 'sponsor', segment: [1, 20] },
            { category: 'sponsor', segment: [1, 20] },
            { category: 'intro', segment: [11, 12] }
          ]
        }
      ],
      'video',
      10
    ),
    [{ category: 'sponsor', segment: [1, 10] }]
  );
});

test('resolveCommand registry composes hooks and rebinds replaced instances', async () => {
  const firstCalls = [];
  const secondCalls = [];
  function targetConstructor() {}
  const firstInstance = {
    resolveCommand(payload) {
      assert.equal(this, firstInstance);
      firstCalls.push(payload);
      return payload;
    }
  };
  const firstOriginal = firstInstance.resolveCommand;
  targetConstructor.instance = firstInstance;
  globalThis.window = {
    _yttv: { targetConstructor },
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout
  };

  const { ResolveCommandRegistry } = await import('../src/app_api/index.ts');
  const registry = await ResolveCommandRegistry.getInstance({ timeoutMs: 100 });
  registry.setHook('first', (payload) => ({ ...payload, firstHandled: true }));
  registry.setHook('second', (payload) => ({
    ...payload,
    secondHandled: true
  }));
  assert.throws(
    () => registry.setHook('first', (payload) => payload),
    /already registered/
  );

  targetConstructor.instance.resolveCommand({ first: {}, second: {} });
  assert.deepEqual(firstCalls, [
    { first: {}, second: {}, firstHandled: true, secondHandled: true }
  ]);

  const secondInstance = {
    resolveCommand(payload) {
      assert.equal(this, secondInstance);
      secondCalls.push(payload);
      return payload;
    }
  };
  const secondOriginal = secondInstance.resolveCommand;
  targetConstructor.instance = secondInstance;
  await ResolveCommandRegistry.getInstance();
  assert.equal(firstInstance.resolveCommand, firstOriginal);
  targetConstructor.instance.resolveCommand({ first: {} });
  assert.deepEqual(secondCalls, [{ first: {}, firstHandled: true }]);
  registry.destroy();
  assert.equal(secondInstance.resolveCommand, secondOriginal);
});

test('resolveCommand rebind preserves a host wrapper that captured the hook', async () => {
  const calls = [];
  function targetConstructor() {}
  const instance = {
    resolveCommand(payload) {
      calls.push(payload);
      return payload;
    }
  };
  targetConstructor.instance = instance;
  globalThis.window = {
    _yttv: { targetConstructor },
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout
  };

  const { ResolveCommandRegistry } = await import('../src/app_api/index.ts');
  const registry = await ResolveCommandRegistry.getInstance({ timeoutMs: 100 });
  registry.setHook('wrapped', (payload) => ({ ...payload, transformed: true }));
  const capturedHook = instance.resolveCommand;
  let hostCalls = 0;
  const hostWrapper = function (payload, extra) {
    hostCalls++;
    return Reflect.apply(capturedHook, this, [payload, extra]);
  };
  instance.resolveCommand = hostWrapper;
  await ResolveCommandRegistry.getInstance();

  instance.resolveCommand({ wrapped: true });
  assert.equal(hostCalls, 1);
  assert.deepEqual(calls, [{ wrapped: true, transformed: true }]);

  registry.destroy();
  assert.equal(instance.resolveCommand, hostWrapper);
  instance.resolveCommand({ wrapped: true });
  assert.deepEqual(calls.at(-1), { wrapped: true });
});

test('resolveCommand callers have independent timeouts', async () => {
  function targetConstructor() {}
  globalThis.window = {
    _yttv: {},
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout
  };
  const { ResolveCommandRegistry } = await import('../src/app_api/index.ts');
  const shortWait = ResolveCommandRegistry.getInstance({ timeoutMs: 30 });
  const longWait = ResolveCommandRegistry.getInstance({ timeoutMs: 300 });
  setTimeout(() => {
    targetConstructor.instance = {
      resolveCommand(payload) {
        return payload;
      }
    };
    globalThis.window._yttv.targetConstructor = targetConstructor;
  }, 80);

  await assert.rejects(shortWait, /timed out after 30ms/);
  const registry = await longWait;
  assert.ok(registry instanceof ResolveCommandRegistry);
  registry.destroy();
});

test('deferred resolveCommand hooks bind targets that appear after bootstrap', async () => {
  let synchronize;
  globalThis.window = {
    _yttv: {},
    setInterval(callback) {
      synchronize = callback;
      return 1;
    },
    clearInterval,
    setTimeout,
    clearTimeout
  };
  const { ResolveCommandRegistry } = await import('../src/app_api/index.ts');
  const registry = ResolveCommandRegistry.getDeferredInstance();
  registry.setHook('lateCommand', (payload) => ({
    ...payload,
    deferred: true
  }));

  const calls = [];
  function lateConstructor() {}
  lateConstructor.instance = {
    resolveCommand(payload) {
      calls.push(payload);
      return payload;
    }
  };
  globalThis.window._yttv.lateConstructor = lateConstructor;
  synchronize();
  lateConstructor.instance.resolveCommand({ lateCommand: true });
  assert.deepEqual(calls, [{ lateCommand: true, deferred: true }]);
  registry.destroy();
});
