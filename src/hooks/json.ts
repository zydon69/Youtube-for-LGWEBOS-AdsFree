import { cloneTransformValue } from '../core/clone-transform-value.ts';
import { MAX_JSON_TRANSFORM_BYTES } from '../core/transform-limits.js';

type ParseTransformer = (value: unknown) => unknown;
type StringifyTransformer = (value: unknown) => unknown;
type TransformerRegistration<TApplicabilityInput> = {
  transform: ParseTransformer;
  enabled: () => boolean;
  applies: (input: TApplicabilityInput) => boolean;
};
export type JSONParseApplicability = (value: unknown) => boolean;
export type JSONStringifyApplicability = (serialized: string) => boolean;
type JSONReviver = Parameters<typeof JSON.parse>[1];
type JSONReplacer = Parameters<typeof JSON.stringify>[1];

export interface JSONHookTarget {
  parse: typeof JSON.parse;
  stringify: typeof JSON.stringify;
}

interface JSONHookInstallation {
  readonly target: JSONHookTarget;
  readonly baseParse: typeof JSON.parse;
  nativeParse: typeof JSON.parse;
  nativeStringify: typeof JSON.stringify;
  hookedParse: typeof JSON.parse;
  hookedStringify: typeof JSON.stringify;
}

const parseTransformers = new Map<string, TransformerRegistration<unknown>>();
const stringifyTransformers = new Map<
  string,
  TransformerRegistration<string>
>();
let installation: JSONHookInstallation | null = null;
let parseHookDepth = 0;
let stringifyHookDepth = 0;

function validateRegistration<TApplicabilityInput>(
  name: string,
  transformer: ParseTransformer,
  enabled: () => boolean,
  applies: (input: TApplicabilityInput) => boolean
) {
  if (!name) throw new TypeError('JSON transformer name is required');
  if (typeof transformer !== 'function') {
    throw new TypeError('JSON transformer "' + name + '" must be a function');
  }
  if (typeof enabled !== 'function') {
    throw new TypeError(
      'JSON transformer "' + name + '" predicate must be a function'
    );
  }
  if (typeof applies !== 'function') {
    throw new TypeError(
      'JSON transformer "' + name + '" applicability must be a function'
    );
  }
}

export function registerJSONParseTransformer(
  name: string,
  transformer: ParseTransformer,
  enabled: () => boolean = () => true,
  applies: JSONParseApplicability = () => true
) {
  validateRegistration(name, transformer, enabled, applies);
  if (parseTransformers.has(name)) {
    throw new Error('JSON transformer "' + name + '" is already registered');
  }
  const registration = { transform: transformer, enabled, applies };
  parseTransformers.set(name, registration);
  try {
    synchronizeJSONHooks(installation?.target ?? globalThis.JSON);
  } catch (error) {
    parseTransformers.delete(name);
    throw error;
  }
  return () =>
    parseTransformers.get(name) === registration &&
    parseTransformers.delete(name);
}

export function registerJSONStringifyTransformer(
  name: string,
  transformer: StringifyTransformer,
  enabled: () => boolean = () => true,
  applies: JSONStringifyApplicability = () => true
) {
  validateRegistration(name, transformer, enabled, applies);
  if (stringifyTransformers.has(name)) {
    throw new Error(
      'JSON stringify transformer "' + name + '" is already registered'
    );
  }
  const registration = { transform: transformer, enabled, applies };
  stringifyTransformers.set(name, registration);
  try {
    synchronizeJSONHooks(installation?.target ?? globalThis.JSON);
  } catch (error) {
    stringifyTransformers.delete(name);
    throw error;
  }
  return () =>
    stringifyTransformers.get(name) === registration &&
    stringifyTransformers.delete(name);
}

function applicableTransformers<TApplicabilityInput>(
  registrations: ReadonlyMap<
    string,
    TransformerRegistration<TApplicabilityInput>
  >,
  input: TApplicabilityInput,
  operation: 'parse' | 'stringify'
) {
  const applicable: Array<
    [string, TransformerRegistration<TApplicabilityInput>]
  > = [];
  for (const [name, registration] of registrations) {
    try {
      if (registration.enabled() && registration.applies(input)) {
        applicable.push([name, registration]);
      }
    } catch (error) {
      console.error(
        '[json] ' + operation + ' predicate "' + name + '" failed',
        error
      );
    }
  }
  return applicable;
}

function applyTransformers(
  value: unknown,
  registrations: readonly [string, { readonly transform: ParseTransformer }][],
  operation: 'parse' | 'stringify'
) {
  let transformed = value;
  for (const [name, registration] of registrations) {
    try {
      // Each transform gets one structural checkpoint. A failed transform is
      // discarded without repeated stringify/parse cycles or partial mutation.
      transformed = registration.transform(cloneTransformValue(transformed));
    } catch (error) {
      console.error(
        '[json] ' + operation + ' transformer "' + name + '" failed',
        error
      );
    }
  }
  return transformed;
}

function parseWithHooks(
  target: JSONHookTarget,
  delegate: typeof JSON.parse,
  text: string,
  reviver?: JSONReviver
) {
  parseHookDepth++;
  let value: unknown;
  try {
    value = Reflect.apply(delegate, target, [text, reviver]);
  } finally {
    parseHookDepth--;
  }

  // A host wrapper can retain an older YTAF wrapper. Only the newest wrapper
  // owns transformation; retained wrappers act as transparent delegates.
  if (parseHookDepth > 0) return value;
  if (typeof text === 'string' && text.length > MAX_JSON_TRANSFORM_BYTES) {
    console.warn('[json] Parsed payload exceeds transform byte limit');
    return value;
  }

  // Native JSON.parse ignores null and every other non-callable reviver.
  if (typeof reviver === 'function') return value;
  const registrations = applicableTransformers(
    parseTransformers,
    value,
    'parse'
  );
  return registrations.length > 0
    ? applyTransformers(value, registrations, 'parse')
    : value;
}

function hasActiveReplacer(replacer: unknown) {
  return typeof replacer === 'function' || Array.isArray(replacer);
}

function stringifyWithHooks(
  target: JSONHookTarget,
  delegate: typeof JSON.stringify,
  parseDelegate: typeof JSON.parse,
  value: unknown,
  replacer?: JSONReplacer,
  space?: string | number
) {
  // This first native call is the single evaluation of getters and toJSON.
  stringifyHookDepth++;
  let serialized: string | undefined;
  try {
    serialized = Reflect.apply(delegate, target, [value, replacer, space]);
  } finally {
    stringifyHookDepth--;
  }
  if (stringifyHookDepth > 0) return serialized;
  if (serialized === undefined || hasActiveReplacer(replacer))
    return serialized;
  if (serialized.length > MAX_JSON_TRANSFORM_BYTES) {
    console.warn('[json] Serialized payload exceeds transform byte limit');
    return serialized;
  }

  // Applicability runs against the already-produced native JSON text, so an
  // irrelevant request pays neither an extra parse nor a full-graph clone.
  const registrations = applicableTransformers(
    stringifyTransformers,
    serialized,
    'stringify'
  );
  if (registrations.length === 0) return serialized;

  const serializableValue = Reflect.apply(parseDelegate, target, [serialized]);
  const transformed = applyTransformers(
    serializableValue,
    registrations,
    'stringify'
  );
  stringifyHookDepth++;
  try {
    return Reflect.apply(delegate, target, [transformed, undefined, space]);
  } finally {
    stringifyHookDepth--;
  }
}

function createParseHook(target: JSONHookTarget, delegate: typeof JSON.parse) {
  return ((text: string, reviver?: JSONReviver) =>
    parseWithHooks(target, delegate, text, reviver)) as typeof JSON.parse;
}

function createStringifyHook(
  target: JSONHookTarget,
  delegate: typeof JSON.stringify,
  parseDelegate: typeof JSON.parse
) {
  return ((value: unknown, replacer?: JSONReplacer, space?: string | number) =>
    stringifyWithHooks(
      target,
      delegate,
      parseDelegate,
      value,
      replacer,
      space
    )) as typeof JSON.stringify;
}

function detachJSONHooks(state: JSONHookInstallation) {
  try {
    if (state.target.parse === state.hookedParse) {
      state.target.parse = state.nativeParse;
    }
  } catch (error) {
    console.warn('[json] Unable to restore JSON.parse', error);
  }
  try {
    if (state.target.stringify === state.hookedStringify) {
      state.target.stringify = state.nativeStringify;
    }
  } catch (error) {
    console.warn('[json] Unable to restore JSON.stringify', error);
  }
  if (installation === state) installation = null;
}

function bindJSONHooks(state: JSONHookInstallation) {
  const currentParse = state.target.parse;
  const currentStringify = state.target.stringify;
  const rebindParse = currentParse !== state.hookedParse;
  const rebindStringify = currentStringify !== state.hookedStringify;
  if (!rebindParse && !rebindStringify) return;
  if (rebindParse && typeof currentParse !== 'function') {
    throw new TypeError('JSON.parse replacement must be callable');
  }
  if (rebindStringify && typeof currentStringify !== 'function') {
    throw new TypeError('JSON.stringify replacement must be callable');
  }

  const nextParse = rebindParse
    ? createParseHook(state.target, currentParse)
    : state.hookedParse;
  const nextStringify = rebindStringify
    ? createStringifyHook(state.target, currentStringify, state.baseParse)
    : state.hookedStringify;
  let parseAttempted = false;
  let stringifyAttempted = false;
  try {
    if (rebindParse) {
      parseAttempted = true;
      state.target.parse = nextParse;
      if (state.target.parse !== nextParse) {
        throw new TypeError('Unable to bind JSON.parse hook');
      }
    }
    if (rebindStringify) {
      stringifyAttempted = true;
      state.target.stringify = nextStringify;
      if (state.target.stringify !== nextStringify) {
        throw new TypeError('Unable to bind JSON.stringify hook');
      }
    }
  } catch (error) {
    try {
      if (parseAttempted && state.target.parse !== currentParse) {
        state.target.parse = currentParse;
      }
    } catch (rollbackError) {
      console.warn('[json] Unable to roll back JSON.parse hook', rollbackError);
    }
    try {
      if (stringifyAttempted && state.target.stringify !== currentStringify) {
        state.target.stringify = currentStringify;
      }
    } catch (rollbackError) {
      console.warn(
        '[json] Unable to roll back JSON.stringify hook',
        rollbackError
      );
    }
    throw error;
  }

  if (rebindParse) {
    state.nativeParse = currentParse;
    state.hookedParse = nextParse;
  }
  if (rebindStringify) {
    state.nativeStringify = currentStringify;
    state.hookedStringify = nextStringify;
  }
}

/** Install or rebind hooks after the host replaces JSON methods or the realm. */
export function synchronizeJSONHooks(target: JSONHookTarget = globalThis.JSON) {
  if (installation && installation.target !== target) {
    detachJSONHooks(installation);
  }

  if (!installation) {
    if (
      typeof target.parse !== 'function' ||
      typeof target.stringify !== 'function'
    ) {
      throw new TypeError('JSON hook target must expose parse and stringify');
    }
    const state = {
      target,
      baseParse: target.parse,
      nativeParse: target.parse,
      nativeStringify: target.stringify,
      hookedParse: undefined as unknown as typeof JSON.parse,
      hookedStringify: undefined as unknown as typeof JSON.stringify
    } satisfies JSONHookInstallation;
    bindJSONHooks(state);
    installation = state;
  }

  const state = installation;
  bindJSONHooks(state);

  return state;
}

export const installJSONHooks = synchronizeJSONHooks;

export function restoreJSONHooks() {
  if (installation) detachJSONHooks(installation);
  parseTransformers.clear();
  stringifyTransformers.clear();
}
