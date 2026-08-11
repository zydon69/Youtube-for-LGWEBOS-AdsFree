import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

import { parse } from '@babel/parser';

import { PROJECT_ROOT } from './package-contract.js';

const textExtensions = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.svg',
  '.ts',
  '.txt',
  '.yaml',
  '.yml'
]);
const excludedDirectories = new Set([
  '.git',
  'coverage',
  'node_modules',
  'playwright-report',
  'screenshots',
  'test-results'
]);
const allowedRuntimeOrigins = new Set([
  'https://i.ytimg.com',
  'https://sponsor.ajay.app',
  'https://www.youtube.com'
]);
const expectedSourceSinks = new Map([
  ['src/core/sponsorblock-client.js', new Map([['fetch', 1]])],
  ['src/hooks/fetch.ts', new Map([['fetch-forward', 1]])],
  ['src/sponsorblock.js', new Map([['fetch', 1]])],
  [
    'src/thumbnail-quality.ts',
    new Map([
      ['css-url', 2],
      ['resource-src', 2]
    ])
  ],
  ['src/utils.js', new Map([['navigation', 1]])]
]);

/** @param {string} directory @returns {Promise<string[]>} */
async function listTextFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      if (entry.isDirectory()) {
        return excludedDirectories.has(entry.name)
          ? []
          : listTextFiles(join(directory, entry.name));
      }
      return entry.isFile() && textExtensions.has(extname(entry.name))
        ? [join(directory, entry.name)]
        : [];
    })
  );
  return files.flat().sort();
}

/** @param {string} directory @returns {Promise<string[]>} */
async function listRuntimeSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return listRuntimeSources(path);
      if (
        entry.isFile() &&
        ['.js', '.ts'].includes(extname(entry.name)) &&
        !entry.name.endsWith('.d.ts')
      ) {
        return [path];
      }
      return [];
    })
  );
  return files.flat().sort();
}

/** @param {any} node @param {Map<string, string>} [constants] */
function memberName(node, constants = new Map()) {
  if (!node || node.type !== 'MemberExpression') return null;
  if (!node.computed && node.property?.type === 'Identifier') {
    return node.property.name;
  }
  if (node.property?.type === 'StringLiteral') return node.property.value;
  if (node.computed) {
    return evaluateStaticString(node.property, constants);
  }
  if (node.property?.type === 'PrivateName')
    return node.property.id?.name ?? null;
  return null;
}

/** @param {any} node @param {Map<string, string>} [constants] @returns {string} */
function expressionName(node, constants = new Map()) {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'ThisExpression') return 'this';
  if (node.type === 'PrivateName') return `#${node.id?.name ?? ''}`;
  if (node.type === 'MemberExpression') {
    const object = expressionName(node.object, constants);
    const property = memberName(node, constants);
    return property ? `${object}.${property}` : object;
  }
  return '';
}

/** @param {any} node @param {Map<string, string>} constants @param {Set<string>} [seen] @returns {string | null} */
function evaluateStaticString(node, constants, seen = new Set()) {
  if (!node) return null;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'NumericLiteral' || node.type === 'BooleanLiteral') {
    return String(node.value);
  }
  if (node.type === 'TemplateLiteral') {
    let value = '';
    for (let index = 0; index < node.quasis.length; index++) {
      value += node.quasis[index]?.value?.cooked ?? '';
      const expression = node.expressions[index];
      if (expression) {
        const evaluated = evaluateStaticString(expression, constants, seen);
        if (evaluated === null) return null;
        value += evaluated;
      }
    }
    return value;
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = evaluateStaticString(node.left, constants, seen);
    const right = evaluateStaticString(node.right, constants, seen);
    return left === null || right === null ? null : left + right;
  }
  if (node.type === 'Identifier') {
    if (seen.has(node.name)) return null;
    const value = constants.get(node.name);
    if (value === undefined) return null;
    seen.add(node.name);
    return value;
  }
  if (
    [
      'ParenthesizedExpression',
      'TSAsExpression',
      'TSSatisfiesExpression'
    ].includes(node.type)
  ) {
    return evaluateStaticString(node.expression, constants, seen);
  }
  return null;
}

/** @param {any} root @param {(node: any, parent: any, grandparent: any) => void} visit */
function walk(root, visit) {
  /** @type {Array<{ node: any, parent: any, grandparent: any }>} */
  const stack = [{ node: root, parent: null, grandparent: null }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    const { node, parent, grandparent } = current;
    if (!node || typeof node !== 'object') continue;
    visit(node, parent, grandparent);
    for (const [key, value] of Object.entries(node)) {
      if (
        [
          'comments',
          'end',
          'extra',
          'innerComments',
          'leadingComments',
          'loc',
          'start',
          'trailingComments'
        ].includes(key)
      ) {
        continue;
      }
      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index--) {
          stack.push({ node: value[index], parent: node, grandparent: parent });
        }
      } else if (value && typeof value === 'object') {
        stack.push({ node: value, parent: node, grandparent: parent });
      }
    }
  }
}

/** @param {any} ast */
function collectTopLevelConstants(ast) {
  /** @type {any[]} */
  const declarations = [];
  walk(ast, (node, parent, grandparent) => {
    if (
      node.type === 'VariableDeclarator' &&
      node.id?.type === 'Identifier' &&
      parent?.type === 'VariableDeclaration' &&
      (grandparent?.type === 'Program' ||
        grandparent?.type === 'ExportNamedDeclaration')
    ) {
      declarations.push(node);
    }
  });
  const constants = new Map();
  for (let iteration = 0; iteration < declarations.length; iteration++) {
    let changed = false;
    for (const declaration of declarations) {
      const value = evaluateStaticString(declaration.init, constants);
      if (value !== null && constants.get(declaration.id.name) !== value) {
        constants.set(declaration.id.name, value);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return constants;
}

/** @param {any} node @param {Map<string, string>} constants */
function classifySink(node, constants) {
  if (node.type === 'CallExpression') {
    const callee = expressionName(node.callee, constants);
    if (
      callee === 'fetch' ||
      callee.endsWith('.fetch') ||
      /(?:^|\.)fetchImpl$/.test(callee) ||
      /(?:^|\.)fetch[A-Z][A-Za-z0-9]*$/.test(callee)
    ) {
      return { kind: 'fetch', value: node.arguments[0] };
    }
    if (
      callee === 'Reflect.apply' &&
      expressionName(node.arguments[0], constants)
        .toLowerCase()
        .includes('fetch')
    ) {
      return { kind: 'fetch-forward', value: node.arguments[1] };
    }
    if (/location\.(?:assign|replace)$/.test(callee)) {
      return { kind: 'navigation', value: node.arguments[0] };
    }
    if (callee === 'open' || callee === 'window.open') {
      return { kind: 'navigation', value: node.arguments[0] };
    }
    if (callee.endsWith('.sendBeacon') || callee === 'sendBeacon') {
      return { kind: 'beacon', value: node.arguments[0] };
    }
    if (
      callee.endsWith('.setProperty') &&
      node.arguments[0]?.type === 'StringLiteral' &&
      node.arguments[0].value.toLowerCase() === 'background-image'
    ) {
      return { kind: 'css-url', value: node.arguments[1] };
    }
    if (
      callee.endsWith('.setAttribute') &&
      node.arguments[0]?.type === 'StringLiteral' &&
      ['href', 'src'].includes(node.arguments[0].value.toLowerCase())
    ) {
      return { kind: 'resource-attribute', value: node.arguments[1] };
    }
  }
  if (node.type === 'NewExpression') {
    const constructor = expressionName(node.callee, constants)
      .split('.')
      .at(-1);
    if (constructor && ['EventSource', 'WebSocket'].includes(constructor)) {
      return { kind: constructor.toLowerCase(), value: node.arguments[0] };
    }
  }
  if (node.type === 'AssignmentExpression') {
    const property = memberName(node.left, constants);
    const left = expressionName(node.left, constants);
    if (property === 'src') return { kind: 'resource-src', value: node.right };
    if (property === 'srcset') {
      return { kind: 'resource-srcset', value: node.right };
    }
    if (property === 'backgroundImage') {
      return { kind: 'css-url', value: node.right };
    }
    if (property === 'href' && left.includes('location.href')) {
      return { kind: 'navigation', value: node.right };
    }
    if (left === 'location' || left.endsWith('.location')) {
      return { kind: 'navigation', value: node.right };
    }
  }
  return null;
}

/** @param {string} name @param {string} value @param {string[]} failures @param {Set<string>} origins */
function inspectNetworkText(name, value, failures, origins) {
  for (const match of value.matchAll(
    /(?:https?:)?\/\/[\p{L}\d][^\s"'`<>()\]}]*/gu
  )) {
    const candidate = match[0];
    if (candidate.startsWith('//')) {
      failures.push(`${name}: protocol-relative network target ${candidate}`);
      continue;
    }
    let url;
    try {
      url = new URL(candidate);
    } catch {
      failures.push(`${name}: malformed network target ${candidate}`);
      continue;
    }
    origins.add(url.origin);
    if (url.protocol !== 'https:') {
      failures.push(`${name}: clear-text network target ${candidate}`);
    } else if (!allowedRuntimeOrigins.has(url.origin)) {
      failures.push(`${name}: unapproved runtime origin ${url.origin}`);
    }
  }
}

/** @param {string} path @param {boolean} enforceSourceContract @param {string[]} failures @param {Set<string>} origins */
async function inspectJavaScript(
  path,
  enforceSourceContract,
  failures,
  origins
) {
  const name = relative(PROJECT_ROOT, path);
  const content = await readFile(path, 'utf8');
  let ast;
  try {
    ast = parse(content, {
      sourceType: 'unambiguous',
      attachComment: false,
      plugins: [
        'classPrivateMethods',
        'classPrivateProperties',
        'importAttributes',
        'jsx',
        'topLevelAwait',
        'typescript'
      ]
    });
  } catch (error) {
    failures.push(
      `${name}: parser failure: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }

  const constants = enforceSourceContract
    ? collectTopLevelConstants(ast)
    : new Map();
  /** @type {Map<string, number>} */
  const sinks = new Map();
  if (name === 'src/thumbnail-quality.ts') {
    if (
      !content.includes("input.protocol !== 'https:'") ||
      !content.includes("input.hostname !== 'i.ytimg.com'")
    ) {
      failures.push(
        `${name}: thumbnail HTTPS/host validation contract changed`
      );
    } else {
      origins.add('https://i.ytimg.com');
    }
  }
  walk(ast, (node) => {
    const referencedName =
      node.type === 'Identifier'
        ? node.name
        : node.type === 'MemberExpression'
          ? memberName(node, constants)
          : null;
    if (
      referencedName &&
      [
        'EventSource',
        'SharedWorker',
        'RTCPeerConnection',
        'WebTransport',
        'WebSocket',
        'Worker',
        'XMLHttpRequest',
        'importScripts',
        'sendBeacon',
        'serviceWorker'
      ].includes(referencedName) &&
      enforceSourceContract
    ) {
      failures.push(`${name}: forbidden runtime API ${referencedName}`);
    }
    const calledName = ['CallExpression', 'NewExpression'].includes(node.type)
      ? expressionName(node.callee, constants).split('.').at(-1)
      : null;
    if (
      enforceSourceContract &&
      ((node.type === 'CallExpression' && calledName === 'eval') ||
        (['CallExpression', 'NewExpression'].includes(node.type) &&
          calledName === 'Function'))
    ) {
      failures.push(`${name}: forbidden dynamic code execution`);
    }

    if (
      enforceSourceContract &&
      ['StringLiteral', 'TemplateLiteral', 'BinaryExpression'].includes(
        node.type
      )
    ) {
      const value = evaluateStaticString(node, constants);
      if (value !== null) inspectNetworkText(name, value, failures, origins);
    }

    const sink = classifySink(node, constants);
    if (!sink) return;
    sinks.set(sink.kind, (sinks.get(sink.kind) ?? 0) + 1);
    const value = evaluateStaticString(sink.value, constants);
    if (value !== null) inspectNetworkText(name, value, failures, origins);
  });

  if (!enforceSourceContract) return;
  const expected = expectedSourceSinks.get(name) ?? new Map();
  const actual = [...sinks.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );
  const contract = [...expected.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );
  if (JSON.stringify(actual) !== JSON.stringify(contract)) {
    failures.push(
      `${name}: egress sink contract changed; actual=${JSON.stringify(Object.fromEntries(actual))}, expected=${JSON.stringify(Object.fromEntries(contract))}`
    );
  }
}

/** @param {string} path @param {string[]} failures @param {Set<string>} origins */
async function inspectMarkup(path, failures, origins) {
  const name = relative(PROJECT_ROOT, path);
  const content = await readFile(path, 'utf8');
  if (extname(path) === '.css') {
    for (const match of content.matchAll(/url\(([^)]*)\)/gi)) {
      const value = match[1]?.trim().replace(/^["']|["']$/g, '');
      if (value && !value.startsWith('data:')) {
        inspectNetworkText(name, value, failures, origins);
      }
    }
    return;
  }
  for (const match of content.matchAll(
    /\b(?:action|href|poster|src)\s*=\s*["']([^"']+)["']/gi
  )) {
    const value = match[1]?.trim();
    if (value && !value.startsWith('data:') && !value.startsWith('#')) {
      inspectNetworkText(name, value, failures, origins);
    }
  }
}

const failures = [];
const origins = new Set();
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[oprsu]_\w{30,}\b/
];

for (const path of await listTextFiles(PROJECT_ROOT)) {
  // Sequential reads cap memory while scanning the complete working tree.
  // eslint-disable-next-line no-await-in-loop
  const content = await readFile(path, 'utf8');
  const name = relative(PROJECT_ROOT, path);
  for (const pattern of secretPatterns) {
    if (pattern.test(content))
      failures.push(`${name}: possible committed secret`);
  }
}

for (const path of await listRuntimeSources(join(PROJECT_ROOT, 'src'))) {
  // Each parser instance is released before the next source file.
  // eslint-disable-next-line no-await-in-loop
  await inspectJavaScript(path, true, failures, origins);
}

for (const path of [
  join(PROJECT_ROOT, 'dist', 'index.js'),
  join(PROJECT_ROOT, 'dist', 'webOSUserScripts', 'userScript.js')
]) {
  // Production bundles are scanned in addition to their source modules.
  // eslint-disable-next-line no-await-in-loop
  await inspectJavaScript(path, false, failures, origins);
}

const runtimeMarkup = (await listTextFiles(join(PROJECT_ROOT, 'src'))).filter(
  (path) => ['.css', '.html'].includes(extname(path))
);
for (const path of runtimeMarkup) {
  // eslint-disable-next-line no-await-in-loop
  await inspectMarkup(path, failures, origins);
}

for (const expectedOrigin of allowedRuntimeOrigins) {
  if (!origins.has(expectedOrigin)) {
    failures.push(`Runtime origin contract is missing ${expectedOrigin}`);
  }
}

if (failures.length > 0) {
  throw new Error(
    `Security policy failed:\n${[...new Set(failures)].join('\n')}`
  );
}
console.info(
  `Security policy passed: ${origins.size} reviewed origins, exact source sink inventory, source/bundle/vendor scan and secret scan`
);
