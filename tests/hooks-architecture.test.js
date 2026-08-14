import assert from 'node:assert/strict';
import test from 'node:test';

import {
  installJSONHooks,
  registerJSONParseTransformer,
  registerJSONStringifyTransformer,
  restoreJSONHooks,
  synchronizeJSONHooks
} from '../src/hooks/json.ts';
import { FetchRegistry, disposeFetchRegistry } from '../src/hooks/fetch.ts';
import { TypedCustomEvent } from '../src/custom-event-target.ts';

test('JSON hooks honor inactive native arguments and avoid serialization loops', (context) => {
  context.after(restoreJSONHooks);
  restoreJSONHooks();
  installJSONHooks();

  const unregisterParse = registerJSONParseTransformer(
    'parse-marker',
    (value) => ({
      ...value,
      parsed: true
    })
  );
  registerJSONStringifyTransformer('stringify-marker', (value) => ({
    ...value,
    stringified: true
  }));
  registerJSONStringifyTransformer('failing-transform', (value) => {
    value.leak = true;
    throw new Error('expected failure');
  });

  const previousError = console.error;
  console.error = () => undefined;
  try {
    assert.deepEqual(JSON.parse('{"value":1}', null), {
      value: 1,
      parsed: true
    });
    assert.deepEqual(JSON.parse('{"value":1}', 42), {
      value: 1,
      parsed: true
    });
    assert.equal(
      JSON.stringify({ value: 1 }, null),
      '{"value":1,"stringified":true}'
    );
    assert.equal(
      JSON.stringify({ value: 1 }, { ignored: true }),
      '{"value":1,"stringified":true}'
    );

    assert.deepEqual(
      JSON.parse('{"value":1}', (_key, value) => value),
      { value: 1 }
    );
    assert.equal(JSON.stringify({ value: 1 }, ['value']), '{"value":1}');
    assert.equal(unregisterParse(), true);
    assert.equal(unregisterParse(), false);
    assert.deepEqual(JSON.parse('{"value":1}', null), { value: 1 });
  } finally {
    console.error = previousError;
  }
});

test('JSON hooks rebind a host replacement and use a bounded transform pipeline', (context) => {
  context.after(restoreJSONHooks);
  restoreJSONHooks();
  const nativeParse = JSON.parse;
  const nativeStringify = JSON.stringify;
  let parseCalls = 0;
  let stringifyCalls = 0;
  const target = {
    parse(...args) {
      parseCalls++;
      return Reflect.apply(nativeParse, JSON, args);
    },
    stringify(...args) {
      stringifyCalls++;
      return Reflect.apply(nativeStringify, JSON, args);
    }
  };

  synchronizeJSONHooks(target);
  for (let index = 0; index < 3; index++) {
    registerJSONParseTransformer('parse-' + index, (value) => ({
      ...value,
      ['parse' + index]: true
    }));
    registerJSONStringifyTransformer('stringify-' + index, (value) => ({
      ...value,
      ['stringify' + index]: true
    }));
  }
  synchronizeJSONHooks(target);

  parseCalls = 0;
  stringifyCalls = 0;
  assert.equal(target.parse('{"value":1}').parse2, true);
  assert.equal(parseCalls, 1);
  assert.equal(stringifyCalls, 0);

  parseCalls = 0;
  stringifyCalls = 0;
  assert.match(target.stringify({ value: 1 }), /"stringify2":true/);
  assert.equal(parseCalls, 1);
  assert.equal(stringifyCalls, 2);

  let replacementCalls = 0;
  const replacementParse = (...args) => {
    replacementCalls++;
    return Reflect.apply(nativeParse, JSON, args);
  };
  target.parse = replacementParse;
  synchronizeJSONHooks(target);
  assert.equal(target.parse('{"value":1}').parse2, true);
  assert.equal(replacementCalls, 1);
  restoreJSONHooks();
  assert.equal(target.parse, replacementParse);
});

test('JSON hooks preserve host wrappers that captured the previous generation', (context) => {
  context.after(restoreJSONHooks);
  restoreJSONHooks();
  const target = {
    parse: JSON.parse,
    stringify: JSON.stringify
  };
  synchronizeJSONHooks(target);

  let parseTransforms = 0;
  let stringifyTransforms = 0;
  registerJSONParseTransformer('generation-parse', (value) => {
    parseTransforms++;
    return { ...value, parsed: true };
  });
  registerJSONStringifyTransformer('generation-stringify', (value) => {
    stringifyTransforms++;
    return { ...value, stringified: true };
  });

  const capturedParse = target.parse;
  const capturedStringify = target.stringify;
  let hostParseCalls = 0;
  let hostStringifyCalls = 0;
  const hostParse = (...args) => {
    hostParseCalls++;
    return Reflect.apply(capturedParse, target, args);
  };
  const hostStringify = (...args) => {
    hostStringifyCalls++;
    return Reflect.apply(capturedStringify, target, args);
  };
  target.parse = hostParse;
  target.stringify = hostStringify;
  synchronizeJSONHooks(target);

  assert.deepEqual(target.parse('{"value":1}'), { value: 1, parsed: true });
  assert.equal(
    target.stringify({ value: 1 }),
    '{"value":1,"stringified":true}'
  );
  assert.equal(parseTransforms, 1);
  assert.equal(stringifyTransforms, 1);
  assert.equal(hostParseCalls, 1);
  assert.equal(hostStringifyCalls, 2);

  restoreJSONHooks();
  assert.equal(target.parse, hostParse);
  assert.equal(target.stringify, hostStringify);
  assert.deepEqual(target.parse('{"value":1}'), { value: 1 });
});

test('JSON applicability avoids parsing and cloning irrelevant large payloads', (context) => {
  context.after(restoreJSONHooks);
  restoreJSONHooks();
  const massivePayload = {
    items: Array.from({ length: 10_000 }, (_, index) => ({ index }))
  };
  let parseCalls = 0;
  let stringifyCalls = 0;
  let transformCalls = 0;
  const target = {
    parse() {
      parseCalls++;
      return massivePayload;
    },
    stringify(value) {
      stringifyCalls++;
      return JSON.stringify(value);
    }
  };

  synchronizeJSONHooks(target);
  registerJSONParseTransformer(
    'relevant-parse-only',
    (value) => {
      transformCalls++;
      return value;
    },
    () => true,
    (value) => value?.kind === 'relevant'
  );
  registerJSONStringifyTransformer(
    'relevant-stringify-only',
    (value) => {
      transformCalls++;
      return value;
    },
    () => true,
    (serialized) => serialized.includes('"playbackContext"')
  );

  assert.equal(target.parse('{}'), massivePayload);
  assert.equal(target.stringify({ unrelated: true }), '{"unrelated":true}');
  assert.equal(parseCalls, 1);
  assert.equal(stringifyCalls, 1);
  assert.equal(transformCalls, 0);
});

test('JSON hooks skip transformations beyond the bounded payload budget', (context) => {
  context.after(restoreJSONHooks);
  const previousWarn = console.warn;
  console.warn = () => undefined;
  try {
    let transforms = 0;
    registerJSONParseTransformer('bounded-parse', (value) => {
      transforms++;
      return value;
    });
    const oversized = JSON.stringify({
      value: 'x'.repeat(8 * 1024 * 1024)
    });
    JSON.parse(oversized);
    assert.equal(transforms, 0);
  } finally {
    console.warn = previousWarn;
  }
});

test('JSON hook installation rolls back when a host method is unwritable', (context) => {
  context.after(restoreJSONHooks);
  restoreJSONHooks();
  const nativeParse = JSON.parse;
  const nativeStringify = JSON.stringify;
  const target = { parse: nativeParse };
  Object.defineProperty(target, 'stringify', {
    value: nativeStringify,
    writable: false,
    configurable: true
  });

  assert.throws(() => synchronizeJSONHooks(target), TypeError);
  assert.equal(target.parse, nativeParse);
  assert.equal(target.stringify, nativeStringify);
});

test('JSON hook installation rolls back a setter-altered assignment', (context) => {
  context.after(restoreJSONHooks);
  restoreJSONHooks();
  const nativeParse = JSON.parse;
  const nativeStringify = JSON.stringify;
  let storedParse = nativeParse;
  let alterNextAssignment = true;
  const target = { stringify: nativeStringify };
  Object.defineProperty(target, 'parse', {
    configurable: true,
    get: () => storedParse,
    set(value) {
      storedParse = alterNextAssignment ? () => ({ altered: true }) : value;
      alterNextAssignment = false;
    }
  });

  assert.throws(
    () => synchronizeJSONHooks(target),
    /Unable to bind JSON.parse/
  );
  assert.equal(target.parse, nativeParse);
  assert.equal(target.stringify, nativeStringify);
});

test('fetch hooks accept cross-realm request shapes and rebind host fetch', async (context) => {
  context.after(disposeFetchRegistry);
  disposeFetchRegistry();
  const calls = [];
  const firstFetch = async (resource) => {
    calls.push(['first', resource]);
    return new Response('{}');
  };
  const target = {
    fetch: firstFetch,
    location: { href: 'https://www.youtube.com/tv' }
  };
  const registry = FetchRegistry.getInstance(target);
  let observedURL;
  let requestEvents = 0;
  registry.addEventListener('request', (event) => {
    requestEvents++;
    observedURL = event.detail.url.href;
  });

  const foreignRequest = {
    url: 'https://www.youtube.com/tv#/watch?v=architecture',
    toString() {
      throw new Error('cross-realm Request must use its url property');
    }
  };
  await target.fetch(foreignRequest);
  assert.equal(observedURL, 'https://www.youtube.com/tv#/watch?v=architecture');
  assert.equal(calls.length, 1);

  const replacementFetch = async (resource) => {
    calls.push(['replacement', resource]);
    return new Response('replacement');
  };
  target.fetch = replacementFetch;
  registry.synchronize();
  assert.equal(await (await target.fetch('/tv')).text(), 'replacement');
  registry.dispose();
  assert.equal(target.fetch, replacementFetch);
  registry.dispatchEvent(
    new TypedCustomEvent('request', {
      detail: {
        url: new URL('https://www.youtube.com/after-dispose'),
        resource: '/after-dispose'
      }
    })
  );
  assert.equal(requestEvents, 2);
});

test('fetch hooks preserve a host wrapper that captured the previous generation', async (context) => {
  context.after(disposeFetchRegistry);
  disposeFetchRegistry();
  let nativeCalls = 0;
  const nativeFetch = async () => {
    nativeCalls++;
    return new Response('native');
  };
  const target = {
    fetch: nativeFetch,
    location: { href: 'https://www.youtube.com/tv' }
  };
  const registry = FetchRegistry.getInstance(target);
  let requestEvents = 0;
  let responseEvents = 0;
  registry.addEventListener('request', () => requestEvents++);
  registry.addEventListener('response', () => responseEvents++);

  const capturedHook = target.fetch;
  let hostCalls = 0;
  const hostWrapper = async (...args) => {
    hostCalls++;
    return Reflect.apply(capturedHook, target, args);
  };
  target.fetch = hostWrapper;
  registry.synchronize();

  assert.equal(await (await target.fetch('/tv')).text(), 'native');
  assert.equal(hostCalls, 1);
  assert.equal(nativeCalls, 1);
  assert.equal(requestEvents, 1);
  assert.equal(responseEvents, 1);

  registry.dispose();
  assert.equal(target.fetch, hostWrapper);
  await target.fetch('/after-dispose');
  assert.equal(requestEvents, 1);
  assert.equal(responseEvents, 1);
  assert.equal(nativeCalls, 2);
});

test('fetch hook installation fails without replacing an unwritable host method', (context) => {
  context.after(disposeFetchRegistry);
  disposeFetchRegistry();
  const nativeFetch = async () => new Response('{}');
  const target = { location: { href: 'https://www.youtube.com/tv' } };
  Object.defineProperty(target, 'fetch', {
    value: nativeFetch,
    writable: false,
    configurable: true
  });

  assert.throws(() => FetchRegistry.getInstance(target), TypeError);
  assert.equal(target.fetch, nativeFetch);
});

test('fetch hook installation rolls back a setter-altered assignment', (context) => {
  context.after(disposeFetchRegistry);
  disposeFetchRegistry();
  const nativeFetch = async () => new Response('{}');
  let storedFetch = nativeFetch;
  let alterNextAssignment = true;
  const target = { location: { href: 'https://www.youtube.com/tv' } };
  Object.defineProperty(target, 'fetch', {
    configurable: true,
    get: () => storedFetch,
    set(value) {
      storedFetch = alterNextAssignment
        ? async () => new Response('altered')
        : value;
      alterNextAssignment = false;
    }
  });

  assert.throws(
    () => FetchRegistry.getInstance(target),
    /Unable to bind fetch/
  );
  assert.equal(target.fetch, nativeFetch);
});
