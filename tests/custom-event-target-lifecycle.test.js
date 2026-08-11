import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CustomEventTarget,
  TypedCustomEvent
} from '../src/custom-event-target.ts';

test('custom event targets release all feature listeners idempotently', () => {
  const target = new CustomEventTarget();
  let calls = 0;
  target.addEventListener('first', () => calls++);
  target.addEventListener('second', () => calls++);

  target.clearEventListeners();
  target.clearEventListeners();
  target.dispatchEvent(new TypedCustomEvent('first'));
  target.dispatchEvent(new TypedCustomEvent('second'));

  assert.equal(calls, 0);
});
