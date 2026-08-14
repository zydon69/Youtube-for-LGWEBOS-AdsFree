import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

import {
  registerJSONParseTransformer,
  registerJSONStringifyTransformer,
  restoreJSONHooks
} from '../src/hooks/json.ts';
import {
  CustomEventTarget,
  TypedCustomEvent
} from '../src/custom-event-target.ts';
import { InlineStyleOwner } from '../src/core/inline-style-owner.js';
import {
  decideSponsorSkip,
  findNextSponsorSegment
} from '../src/core/sponsorblock-scheduling.js';

test('JSON hooks preserve revivers, replacers and getter execution', (context) => {
  context.after(restoreJSONHooks);
  registerJSONParseTransformer('test-parse', (value) => ({
    ...value,
    seen: true
  }));
  registerJSONStringifyTransformer('test-stringify', (value) => ({
    ...value,
    transformed: true
  }));
  registerJSONStringifyTransformer('test-failure', (value) => {
    value.partial = 'must not leak';
    throw new Error('transform failed');
  });

  const revived = JSON.parse('{"when":"2026-01-01"}', (key, value) =>
    key === 'when' ? new Date(`${value}T00:00:00Z`) : value
  );
  assert.ok(revived.when instanceof Date);

  let getterCalls = 0;
  const source = {
    get value() {
      getterCalls++;
      return 7;
    }
  };
  const previousError = console.error;
  try {
    console.error = () => undefined;
    assert.equal(JSON.stringify(source), '{"value":7,"transformed":true}');
  } finally {
    console.error = previousError;
  }
  assert.equal(getterCalls, 1);
  assert.equal(JSON.stringify(source, ['value']), '{"value":7}');
  assert.equal(getterCalls, 2);
});

test('event listener failures do not skip later listeners', () => {
  const target = new CustomEventTarget();
  const previousError = console.error;
  const errors = [];
  console.error = (...values) => errors.push(values);
  try {
    let called = false;
    target.addEventListener('change', () => {
      throw new Error('listener failed');
    });
    target.addEventListener('change', () => {
      called = true;
    });
    assert.doesNotThrow(() =>
      target.dispatchEvent(new TypedCustomEvent('change'))
    );
    assert.equal(called, true);
    assert.equal(errors.length, 1);
  } finally {
    console.error = previousError;
  }
});

test('owned inline styles restore exactly and preserve host overrides', async () => {
  const window = new Window();
  const element = window.document.createElement('div');
  element.style.setProperty('filter', 'contrast(2)', 'important');
  const owner = new InlineStyleOwner(element, ['filter']);
  owner.set('filter', 'brightness(0)', 'important');
  owner.restore();
  assert.equal(element.style.getPropertyValue('filter'), 'contrast(2)');
  assert.equal(element.style.getPropertyPriority('filter'), 'important');

  const secondOwner = new InlineStyleOwner(element, ['filter']);
  secondOwner.set('filter', 'brightness(0)');
  element.style.filter = 'sepia(1)';
  secondOwner.restore();
  assert.equal(element.style.filter, 'sepia(1)');
  await window.close();
});

test('SponsorBlock scheduling never seeks completed segments backwards', () => {
  const segments = [{ category: 'sponsor', segment: [10, 20] }];
  const allowed = new Set(['sponsor']);
  assert.equal(findNextSponsorSegment(segments, allowed, 20), null);
  assert.equal(decideSponsorSkip([10, 20], 20, 100), null);
  assert.deepEqual(decideSponsorSkip([10, 20], 9, 100), {
    reschedule: true
  });
  assert.deepEqual(decideSponsorSkip([10, 20], 10, 100), { target: 20 });
});
