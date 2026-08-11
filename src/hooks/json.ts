type ParseTransformer = (value: unknown) => unknown;
type StringifyTransformer = (value: unknown) => unknown;
type TransformerRegistration = {
  transform: ParseTransformer;
  enabled: () => boolean;
};
type JSONReviver = Parameters<typeof JSON.parse>[1];
type JSONReplacer = Parameters<typeof JSON.stringify>[1];

const originalParse = JSON.parse;
const originalStringify = JSON.stringify;
const parseTransformers = new Map<string, TransformerRegistration>();
const stringifyTransformers = new Map<string, TransformerRegistration>();

export function registerJSONParseTransformer(
  name: string,
  transformer: ParseTransformer,
  enabled: () => boolean = () => true
) {
  if (parseTransformers.has(name)) {
    throw new Error(`JSON transformer "${name}" is already registered`);
  }
  parseTransformers.set(name, { transform: transformer, enabled });
}

export function registerJSONStringifyTransformer(
  name: string,
  transformer: StringifyTransformer,
  enabled: () => boolean = () => true
) {
  if (stringifyTransformers.has(name)) {
    throw new Error(
      `JSON stringify transformer "${name}" is already registered`
    );
  }
  stringifyTransformers.set(name, { transform: transformer, enabled });
}

function parse(text: string, reviver?: JSONReviver) {
  let value: unknown = originalParse(text, reviver);

  for (const [name, registration] of parseTransformers) {
    if (!registration.enabled()) continue;
    try {
      // Parsed JSON is serializable by definition. Transform a private copy so
      // a failing transformer can never leave the value partially mutated.
      const candidate = originalParse(originalStringify(value));
      value = registration.transform(candidate);
    } catch (error) {
      console.error(`[json] Transformer "${name}" failed`, error);
    }
  }

  return value;
}

function stringify(
  value: unknown,
  replacer?: JSONReplacer,
  space?: string | number
) {
  let transformed = value;
  for (const [name, registration] of stringifyTransformers) {
    if (!registration.enabled()) continue;
    try {
      transformed = registration.transform(transformed);
    } catch (error) {
      console.error(`[json] Stringify transformer "${name}" failed`, error);
    }
  }
  return originalStringify(transformed, replacer as never, space);
}

JSON.parse = parse as typeof JSON.parse;
JSON.stringify = stringify as typeof JSON.stringify;

export function restoreJSONHooks() {
  if (JSON.parse === parse) JSON.parse = originalParse;
  if (JSON.stringify === stringify) JSON.stringify = originalStringify;
  parseTransformers.clear();
  stringifyTransformers.clear();
}
