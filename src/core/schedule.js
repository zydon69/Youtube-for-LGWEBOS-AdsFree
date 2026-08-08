export function scheduleAlignedInterval(
  callback,
  initialDelayMs,
  intervalMs,
  scheduler = globalThis
) {
  let active = true;
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
