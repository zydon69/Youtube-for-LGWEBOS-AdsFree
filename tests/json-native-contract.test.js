import assert from 'node:assert/strict';
import test from 'node:test';
import {
  registerJSONStringifyTransformer,
  restoreJSONHooks,
  synchronizeJSONHooks
} from '../src/hooks/json.ts';
import { MAX_JSON_TRANSFORM_BYTES } from '../src/core/transform-limits.js';

function fixture(context, transformer = (value) => value) {
  restoreJSONHooks();
  context.after(restoreJSONHooks);
  const target = { parse: JSON.parse, stringify: JSON.stringify };
  const nativeStringify = target.stringify;
  synchronizeJSONHooks(target);
  let transforms = 0;
  registerJSONStringifyTransformer('contract', (value) => {
    transforms++;
    return transformer(value);
  });
  return { target, nativeStringify, transforms: () => transforms };
}

for (const space of [
  undefined,
  0,
  -1,
  2.9,
  12,
  Infinity,
  NaN,
  '',
  ' ',
  '\t',
  '\r\n ',
  '--',
  '\u00a0',
  '1234567890tail'
]) {
  test(`stringify preserves native formatting for indentation ${String(space)}`, (context) => {
    const { target, nativeStringify } = fixture(context);
    const value = {
      nested: [{ text: 'newline\nquote"', bool: true }],
      empty: {},
      null: null
    };
    assert.equal(
      target.stringify(value, null, space),
      nativeStringify(value, null, space)
    );
  });
}

for (const value of [
  null,
  undefined,
  true,
  false,
  0,
  -0,
  1.5,
  Infinity,
  NaN,
  'x',
  [],
  {},
  Symbol('x')
]) {
  test(`stringify preserves primitive or empty value ${String(value)}`, (context) => {
    const { target, nativeStringify } = fixture(context);
    assert.equal(target.stringify(value), nativeStringify(value));
  });
}

test('native getters and toJSON are evaluated exactly once even with a transformation', (context) => {
  const { target } = fixture(context, (value) => ({
    ...value,
    transformed: true
  }));
  let getters = 0;
  let toJSON = 0;
  const source = {
    get nested() {
      getters++;
      return {
        toJSON() {
          toJSON++;
          return 7;
        }
      };
    }
  };
  assert.equal(target.stringify(source), '{"nested":7,"transformed":true}');
  assert.equal(getters, 1);
  assert.equal(toJSON, 1);
});

test('active replacer delegates once without transforming its result', (context) => {
  const { target, transforms } = fixture(context, () => {
    throw new Error('must not transform');
  });
  const keys = [];
  assert.equal(
    target.stringify({ a: 1, b: 2 }, (key, value) => {
      keys.push(key);
      return key === 'b' ? undefined : value;
    }),
    '{"a":1}'
  );
  assert.deepEqual(keys, ['', 'a', 'b']);
  assert.equal(transforms(), 0);
});

for (const kind of ['number', 'string']) {
  test(`boxed ${kind} indentation is coerced exactly once`, (context) => {
    const { target, transforms } = fixture(context);
    let conversions = 0;
    const space = kind === 'number' ? new Number(2) : new String(' ');
    space[Symbol.toPrimitive] = () => {
      conversions++;
      return kind === 'number' ? 2 : ' ';
    };
    assert.equal(
      target.stringify({ a: 1 }, null, space),
      kind === 'number' ? '{\n  "a": 1\n}' : '{\n "a": 1\n}'
    );
    assert.equal(conversions, 1);
    assert.equal(transforms(), 0);
  });
}

for (const failure of [
  'getter',
  'toJSON',
  'replacer',
  'bigint',
  'cycle',
  'space'
]) {
  test(`native ${failure} failure propagates before transformers run`, (context) => {
    const { target, transforms } = fixture(context);
    const error = new Error('native failure');
    let source = { a: 1 };
    let replacer;
    let space;
    if (failure === 'getter')
      source = {
        get a() {
          throw error;
        }
      };
    if (failure === 'toJSON')
      source = {
        toJSON() {
          throw error;
        }
      };
    if (failure === 'replacer')
      replacer = () => {
        throw error;
      };
    if (failure === 'bigint') source = 1n;
    if (failure === 'cycle') source.a = source;
    if (failure === 'space') {
      space = new Number(2);
      space[Symbol.toPrimitive] = () => {
        throw error;
      };
    }
    assert.throws(
      () => target.stringify(source, replacer, space),
      failure === 'cycle' || failure === 'bigint'
        ? TypeError
        : (caught) => caught === error
    );
    assert.equal(transforms(), 0);
  });
}

for (const failure of ['throw', 'cycle', 'bigint', 'oversize']) {
  test(`invalid transformer output ${failure} preserves successful native serialization`, (context) => {
    const { target } = fixture(context, (value) => {
      if (failure === 'throw') {
        value.a = 99;
        throw new Error('transform rejected');
      }
      if (failure === 'cycle') {
        value.self = value;
        return value;
      }
      if (failure === 'bigint') return 1n;
      return 'x'.repeat(MAX_JSON_TRANSFORM_BYTES + 1);
    });
    const previousError = console.error;
    const previousWarn = console.warn;
    console.error = () => {};
    console.warn = () => {};
    try {
      assert.equal(target.stringify({ a: 1 }), '{"a":1}');
    } finally {
      console.error = previousError;
      console.warn = previousWarn;
    }
  });
}
