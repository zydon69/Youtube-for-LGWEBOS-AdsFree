/**
 * @param {() => void} callback
 * @param {number} initialDelayMs
 * @param {number} intervalMs
 * @param {{ setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout, setInterval: typeof setInterval, clearInterval: typeof clearInterval }} scheduler
 */
export function scheduleAlignedInterval(
  callback,
  initialDelayMs,
  intervalMs,
  scheduler = globalThis
) {
  if (!Number.isFinite(initialDelayMs) || initialDelayMs < 0) {
    throw new RangeError('initialDelayMs must be a finite non-negative number');
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError('intervalMs must be a finite positive number');
  }
  let active = true;
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let intervalToken;

  const timeoutToken = scheduler.setTimeout(() => {
    if (!active) return;
    callback();
    intervalToken = scheduler.setInterval(callback, intervalMs);
  }, initialDelayMs);

  return () => {
    active = false;
    scheduler.clearTimeout(timeoutToken);
    if (intervalToken !== undefined) scheduler.clearInterval(intervalToken);
  };
}
