import { withInlinePlaybackNoAd } from '../core/json-transforms';

type ParseTransformer = (value: unknown) => unknown;
type JSONReviver = Parameters<typeof JSON.parse>[1];
type JSONReplacer = Parameters<typeof JSON.stringify>[1];

const originalParse = JSON.parse;
const originalStringify = JSON.stringify;
const parseTransformers = new Map<string, ParseTransformer>();

export function registerJSONParseTransformer(
  name: string,
  transformer: ParseTransformer
) {
  if (parseTransformers.has(name)) {
    throw new Error(`JSON transformer "${name}" is already registered`);
  }
  parseTransformers.set(name, transformer);
}

function parse(text: string, reviver?: JSONReviver) {
  let value: unknown = originalParse(text, reviver);

  for (const [name, transformer] of parseTransformers) {
    try {
      value = transformer(value);
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
  return originalStringify(
    withInlinePlaybackNoAd(value),
    replacer as never,
    space
  );
}

JSON.parse = parse as typeof JSON.parse;
JSON.stringify = stringify as typeof JSON.stringify;
