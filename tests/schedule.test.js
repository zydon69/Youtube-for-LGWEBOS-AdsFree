import assert from 'node:assert/strict';
import test from 'node:test';

import { scheduleAlignedInterval } from '../src/core/schedule.js';

test('stopping an aligned interval before alignment prevents interval creation', () => {
  let timeoutCallback;
  let intervalCreated = false;
  let callbackCalls = 0;
  const scheduler = {
    setTimeout(callback) {
      timeoutCallback = callback;
      return 1;
    },
    clearTimeout() {},
    setInterval() {
      intervalCreated = true;
      return 2;
    },
    clearInterval() {}
  };

  const stop = scheduleAlignedInterval(
    () => {
      callbackCalls++;
    },
    100,
    1000,
    scheduler
  );
  stop();
  timeoutCallback();

  assert.equal(callbackCalls, 0);
  assert.equal(intervalCreated, false);
});

test('aligned interval rejects unsafe delays', () => {
  assert.throws(() => scheduleAlignedInterval(() => {}, -1, 1000), RangeError);
  assert.throws(() => scheduleAlignedInterval(() => {}, 0, 0), RangeError);
});
