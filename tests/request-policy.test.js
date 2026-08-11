import assert from 'node:assert/strict';
import test from 'node:test';

import { isWebOSCastWakeRequest } from '../src/core/request-policy.ts';

test('cast wake policy blocks only the exact official endpoint', () => {
  for (const value of [
    'https://www.youtube.com/wake_cast_core',
    'https://www.youtube.com/wake_cast_core/',
    'https://www.youtube.com/wake_cast_core?source=tv'
  ]) {
    assert.equal(isWebOSCastWakeRequest(new URL(value)), true);
  }

  for (const value of [
    'https://www.youtube.com.evil.example/wake_cast_core',
    'http://www.youtube.com/wake_cast_core',
    'https://www.youtube.com/wake_cast_core_extra',
    'https://www.youtube.com/tv'
  ]) {
    assert.equal(isWebOSCastWakeRequest(new URL(value)), false);
  }
});
