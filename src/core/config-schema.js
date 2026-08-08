function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeConfig(value, defaults) {
  const normalized = { ...defaults };
  if (!isRecord(value)) return normalized;

  for (const key of Object.keys(defaults)) {
    if (typeof value[key] === 'boolean') normalized[key] = value[key];
  }

  return normalized;
}
