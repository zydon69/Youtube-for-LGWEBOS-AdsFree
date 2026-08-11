import assert from 'node:assert/strict';
import test from 'node:test';

import { ResolveCommandRegistry } from '../src/app_api/index.ts';
import { fetchSponsorBlockJSON } from '../src/core/sponsorblock-client.js';
import {
  MAX_SPONSORBLOCK_CANDIDATES,
  normalizeSponsorSegments,
  parseSponsorBlockResponse
} from '../src/core/sponsorblock-schema.js';
import {
  computeSponsorDelayMs,
  decideSponsorSkip
} from '../src/core/sponsorblock-scheduling.js';

function createRegistryWindow(entries) {
  return {
    _yttv: entries,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout
  };
}

test('resolveCommand handles ambiguity, isolates hooks and caps private targets', async () => {
  const previousWindow = globalThis.window;
  const calls = Array.from({ length: 10 }, () => []);
  const constructors = {};
  const originals = [];

  for (let index = 0; index < calls.length; index++) {
    const instance = {
      resolveCommand(payload) {
        calls[index].push(payload);
        return payload;
      }
    };
    originals.push(instance.resolveCommand);
    const constructor = function () {};
    constructor.instance = instance;
    constructors[`target${index}`] = constructor;
  }
  globalThis.window = createRegistryWindow(constructors);

  const previousError = console.error;
  console.error = () => undefined;
  try {
    const registry = await ResolveCommandRegistry.getInstance({
      timeoutMs: 100
    });
    registry.setHook('failing', () => {
      throw new Error('feature failure');
    });
    registry.setHook('enabled', (payload) => ({
      ...payload,
      transformed: true
    }));

    for (const constructor of Object.values(constructors)) {
      constructor.instance.resolveCommand({ failing: {}, enabled: {} });
    }

    for (let index = 0; index < 8; index++) {
      assert.deepEqual(calls[index], [
        { failing: {}, enabled: {}, transformed: true }
      ]);
      assert.notEqual(
        constructors[`target${index}`].instance.resolveCommand,
        originals[index]
      );
    }
    for (let index = 8; index < 10; index++) {
      assert.deepEqual(calls[index], [{ failing: {}, enabled: {} }]);
      assert.equal(
        constructors[`target${index}`].instance.resolveCommand,
        originals[index]
      );
    }
    registry.destroy();
    for (let index = 0; index < 8; index++) {
      assert.equal(
        constructors[`target${index}`].instance.resolveCommand,
        originals[index]
      );
    }
  } finally {
    ResolveCommandRegistry.destroyInstance();
    console.error = previousError;
    globalThis.window = previousWindow;
  }
});

test('resolveCommand destruction tolerates a host setter that became unwritable', async () => {
  const previousWindow = globalThis.window;
  const previousWarn = console.warn;
  let warnings = 0;
  console.warn = () => warnings++;
  const instance = { resolveCommand: (payload) => payload };
  const constructor = function () {};
  constructor.instance = instance;
  globalThis.window = createRegistryWindow({ constructor });

  try {
    const registry = await ResolveCommandRegistry.getInstance({
      timeoutMs: 100
    });
    const wrapper = instance.resolveCommand;
    Object.defineProperty(instance, 'resolveCommand', {
      configurable: true,
      get: () => wrapper,
      set: () => {
        throw new Error('host locked property');
      }
    });
    assert.doesNotThrow(() => registry.destroy());
    assert.equal(warnings, 1);
  } finally {
    ResolveCommandRegistry.destroyInstance();
    console.warn = previousWarn;
    globalThis.window = previousWindow;
  }
});

test('resolveCommand binding rolls back a setter-altered assignment', async () => {
  const previousWindow = globalThis.window;
  const previousWarn = console.warn;
  const original = (payload) => payload;
  let stored = original;
  let alterNextAssignment = true;
  const instance = {};
  Object.defineProperty(instance, 'resolveCommand', {
    configurable: true,
    get: () => stored,
    set(value) {
      stored = alterNextAssignment ? () => 'altered' : value;
      alterNextAssignment = false;
    }
  });
  const constructor = function () {};
  constructor.instance = instance;
  globalThis.window = createRegistryWindow({ constructor });
  console.warn = () => undefined;

  try {
    await assert.rejects(
      ResolveCommandRegistry.getInstance({ timeoutMs: 100 }),
      /No writable resolveCommand target/
    );
    assert.equal(instance.resolveCommand, original);
  } finally {
    ResolveCommandRegistry.destroyInstance();
    console.warn = previousWarn;
    globalThis.window = previousWindow;
  }
});

test('resolveCommand construction rolls back when scheduling fails', async () => {
  const previousWindow = globalThis.window;
  const original = (payload) => payload;
  const instance = { resolveCommand: original };
  const constructor = function () {};
  constructor.instance = instance;
  globalThis.window = {
    ...createRegistryWindow({ constructor }),
    setInterval() {
      throw new Error('scheduler unavailable');
    }
  };

  try {
    await assert.rejects(
      ResolveCommandRegistry.getInstance({ timeoutMs: 100 }),
      /scheduler unavailable/
    );
    assert.equal(instance.resolveCommand, original);
  } finally {
    ResolveCommandRegistry.destroyInstance();
    globalThis.window = previousWindow;
  }
});

test('resolveCommand bounds accidental hook expansion', async () => {
  const previousWindow = globalThis.window;
  const previousError = console.error;
  const calls = [];
  const instance = {
    resolveCommand(payload) {
      calls.push(payload);
    }
  };
  const constructor = function () {};
  constructor.instance = instance;
  globalThis.window = createRegistryWindow({ constructor });
  console.error = () => undefined;

  try {
    const registry = await ResolveCommandRegistry.getInstance({
      timeoutMs: 100
    });
    registry.setHook('expand', () =>
      Array.from({ length: 100 }, (_, index) => ({ expanded: index }))
    );
    instance.resolveCommand({ expand: true });
    assert.equal(calls.length, 32);
    assert.deepEqual(calls.at(-1), { expanded: 31 });
  } finally {
    ResolveCommandRegistry.destroyInstance();
    console.error = previousError;
    globalThis.window = previousWindow;
  }
});

test('SponsorBlock sends private fetch options on streaming and legacy CORS paths', async () => {
  const seenOptions = [];
  const modern = await fetchSponsorBlockJSON(
    'https://sponsor.ajay.app/api/test',
    async (_url, options) => {
      seenOptions.push(options);
      return new Response('[]', {
        headers: { 'content-type': 'application/json' }
      });
    }
  );
  const legacy = await fetchSponsorBlockJSON(
    'https://sponsor.ajay.app/api/test',
    async (_url, options) => {
      seenOptions.push(options);
      return {
        ok: true,
        status: 200,
        headers: {
          get(name) {
            return name.toLowerCase() === 'content-type'
              ? 'application/json; charset=utf-8'
              : null;
          }
        },
        body: null,
        text: async () => '[]'
      };
    }
  );

  assert.deepEqual(modern, []);
  assert.deepEqual(legacy, []);
  assert.equal(seenOptions.length, 2);
  for (const options of seenOptions) {
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(options.headers, { Accept: 'application/json' });
    assert.ok(options.signal instanceof AbortSignal);
  }
});

test('SponsorBlock rejects foreign endpoints and times out legacy body reads', async () => {
  await assert.rejects(
    fetchSponsorBlockJSON(
      'https://example.com/api/test',
      async () => new Response('[]')
    ),
    /URL is not allowed/
  );

  const previousAbortController = globalThis.AbortController;
  globalThis.AbortController = undefined;
  try {
    await assert.rejects(
      fetchSponsorBlockJSON(
        'https://sponsor.ajay.app/api/test',
        async () => ({
          ok: true,
          status: 200,
          headers: {
            get: (name) =>
              name.toLowerCase() === 'content-type' ? 'application/json' : null
          },
          body: null,
          text: () => new Promise(() => undefined)
        }),
        { timeoutMs: 5 }
      ),
      /timed out/
    );
  } finally {
    globalThis.AbortController = previousAbortController;
  }
});

test('SponsorBlock retries transient network and Retry-After responses', async () => {
  let networkCalls = 0;
  const networkResult = await fetchSponsorBlockJSON(
    'https://sponsor.ajay.app/api/test',
    async () => {
      networkCalls++;
      if (networkCalls === 1) throw new TypeError('network unavailable');
      return new Response('[]', {
        headers: { 'content-length': '2' }
      });
    }
  );
  assert.deepEqual(networkResult, []);
  assert.equal(networkCalls, 2);

  let rateLimitCalls = 0;
  const rateLimitResult = await fetchSponsorBlockJSON(
    'https://sponsor.ajay.app/api/test',
    async () => {
      rateLimitCalls++;
      if (rateLimitCalls === 1) {
        return new Response('', {
          status: 429,
          headers: { 'retry-after': '0' }
        });
      }
      return new Response('[]', {
        headers: { 'content-length': '2' }
      });
    }
  );
  assert.deepEqual(rateLimitResult, []);
  assert.equal(rateLimitCalls, 2);
});

test('SponsorBlock schema bounds correlation, merges overlaps and schedules by rate', () => {
  const candidates = Array.from(
    { length: MAX_SPONSORBLOCK_CANDIDATES },
    () => ({})
  );
  candidates.push({
    videoID: 'outside-bound',
    segments: [{ category: 'sponsor', segment: [1, 2] }]
  });
  assert.deepEqual(parseSponsorBlockResponse(candidates, 'outside-bound'), []);

  assert.deepEqual(
    normalizeSponsorSegments(
      [
        { category: 'sponsor', segment: [1, 3] },
        { category: 'intro', segment: [1.5, 2] },
        { category: 'sponsor', segment: [2.5, 4] },
        { category: 'sponsor', segment: [2.5, 4] }
      ],
      10
    ),
    [
      { category: 'sponsor', segment: [1, 4] },
      { category: 'intro', segment: [1.5, 2] }
    ]
  );
  assert.equal(computeSponsorDelayMs(20, 10, 2), 5_000);
  assert.equal(computeSponsorDelayMs(20, 10, 0), null);
  assert.deepEqual(decideSponsorSkip([10, 20], 12, Number.NaN), {
    target: 20
  });
});
