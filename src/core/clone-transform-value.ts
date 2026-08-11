/**
 * Clone an acyclic or cyclic JSON-like graph without stringify/parse. Property
 * definitions are used so a parsed "__proto__" key remains ordinary data.
 */
export function cloneTransformValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;

  const root = Array.isArray(value) ? [] : {};
  const clones = new Map<object, object>([[value, root]]);
  const pending: Array<{
    source: object;
    target: Record<string, unknown> | unknown[];
  }> = [{ source: value, target: root }];

  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) break;

    for (const key of Object.keys(entry.source)) {
      const child = (entry.source as Record<string, unknown>)[key];
      let clonedChild = child;
      if (child !== null && typeof child === 'object') {
        const existing = clones.get(child);
        if (existing) {
          clonedChild = existing;
        } else {
          const childClone = Array.isArray(child) ? [] : {};
          clones.set(child, childClone);
          pending.push({ source: child, target: childClone });
          clonedChild = childClone;
        }
      }

      Object.defineProperty(entry.target, key, {
        value: clonedChild,
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
  }

  return root as T;
}
