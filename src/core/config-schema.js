/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @template {Record<string, boolean>} T
 * @param {unknown} value
 * @param {T} defaults
 * @returns {T}
 */
export function normalizeConfig(value, defaults) {
  /** @type {Record<string, boolean>} */
  const normalized = { ...defaults };
  if (!isRecord(value)) return /** @type {T} */ (normalized);

  for (const key of Object.keys(defaults)) {
    if (typeof value[key] === 'boolean') normalized[key] = value[key];
  }

  return /** @type {T} */ (normalized);
}
