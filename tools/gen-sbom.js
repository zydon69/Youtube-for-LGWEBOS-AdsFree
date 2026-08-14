import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import pkgJson from '../package.json' with { type: 'json' };
import {
  DIST_DIRECTORY,
  EXPECTED_APP_FILES,
  PROJECT_ROOT,
  REPOSITORY_URL,
  assertPackageMetadata,
  getBuildProvenance,
  hashDirectory,
  listRelativeFiles,
  parseBuildMode,
  sha256,
  writeFileAtomic
} from './package-contract.js';

const REQUIRED_NOTICE_MARKERS = new Map([
  ['@babel/runtime-corejs3', ['runtime-corejs3', 'Sebastian McKenzie']],
  ['core-js-pure', ['core-js-pure', 'Denis Pushkarev']],
  ['regenerator-runtime', ['regenerator-runtime', 'Facebook, Inc.']],
  ['tiny-sha256', ['tiny-sha256', 'Geraint Luff']],
  ['whatwg-fetch', ['whatwg-fetch', 'GitHub, Inc.']],
  [
    'Financial Times Polyfill Library DOMRect',
    ['Financial Times Polyfill Library DOMRect', 'Financial Times']
  ],
  [
    'WICG Spatial Navigation Polyfill',
    ['WICG Spatial Navigation Polyfill', 'LG Electronics Inc.']
  ]
]);

/** @param {Array<Record<string, any>>} components @param {string} notices */
export function assertRuntimeNotices(components, notices) {
  const normalizedNotices = notices.replace(/\s+/g, ' ');
  for (const component of components) {
    if (component.scope !== 'required') continue;
    const markers = REQUIRED_NOTICE_MARKERS.get(component.name);
    if (
      !markers ||
      markers.some((marker) => !normalizedNotices.includes(marker))
    ) {
      throw new Error(
        `THIRD_PARTY_NOTICES.md is incomplete for ${component.name}`
      );
    }
  }
}
import { runPinnedPnpm } from './pnpm-cli.js';

/** @param {string[]} args */
function runPnpm(args) {
  return runPinnedPnpm(args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

/** @param {string} name @param {string} version */
function npmPurl(name, version) {
  const encodedName = name.split('/').map(encodeURIComponent).join('/');
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

/** @param {string | undefined} license */
function licenseChoice(license) {
  if (!license) return undefined;
  const knownIdentifiers = new Set([
    '0BSD',
    'Apache-2.0',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'CC-BY-4.0',
    'GPL-3.0-only',
    'ISC',
    'MIT',
    'MPL-2.0',
    'Python-2.0',
    'Unlicense'
  ]);
  return [
    knownIdentifiers.has(license)
      ? { license: { id: license } }
      : { license: { name: license } }
  ];
}

/** @param {string} seed */
function deterministicUuid(seed) {
  const characters = sha256(seed).slice(0, 32).split('');
  characters[12] = '5';
  characters[16] = (
    (Number.parseInt(characters[16] ?? '0', 16) & 0x3) |
    0x8
  ).toString(16);
  const hex = characters.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** @param {unknown} report */
function collectLicenses(report) {
  const licenses = new Map();
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('pnpm returned an invalid license report');
  }
  for (const entries of Object.values(report)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (
        !entry ||
        typeof entry.name !== 'string' ||
        typeof entry.license !== 'string' ||
        !Array.isArray(entry.versions)
      ) {
        continue;
      }
      for (const version of entry.versions) {
        if (typeof version === 'string') {
          licenses.set(`${entry.name}@${version}`, entry.license);
        }
      }
    }
  }
  return licenses;
}

/**
 * @param {{
 *   mode?: 'release' | 'development',
 *   outputPath?: string,
 *   distDirectory?: string,
 *   quiet?: boolean
 * }} [options]
 */
export async function generateSbom(options = {}) {
  assertPackageMetadata(pkgJson);
  const mode = options.mode ?? 'release';
  const outputPath = resolve(
    options.outputPath ?? join(PROJECT_ROOT, 'sbom.cdx.json')
  );
  const distDirectory = resolve(options.distDirectory ?? DIST_DIRECTORY);
  const distFiles = await listRelativeFiles(distDirectory);
  if (
    JSON.stringify(distFiles) !== JSON.stringify([...EXPECTED_APP_FILES].sort())
  ) {
    throw new Error('Cannot create an SBOM for an unexpected dist tree');
  }

  const pnpmVersion = runPnpm(['--version']);
  const expectedPnpmVersion =
    pkgJson.packageManager.match(/^pnpm@([^+]+)/)?.[1];
  if (!expectedPnpmVersion || pnpmVersion !== expectedPnpmVersion) {
    throw new Error(
      `SBOM generation requires pnpm ${expectedPnpmVersion ?? '(missing pin)'}; found ${pnpmVersion}`
    );
  }
  const dependencyOutput = JSON.parse(
    runPnpm(['list', '--json', '--depth', 'Infinity'])
  );
  const dependencyTree = dependencyOutput[0];
  if (!dependencyTree || typeof dependencyTree !== 'object') {
    throw new Error('pnpm returned an invalid dependency tree');
  }
  const licenses = collectLicenses(
    JSON.parse(runPnpm(['licenses', 'list', '--json']))
  );
  const provenance = await getBuildProvenance(mode, pkgJson.version);
  const distTreeSha256 = await hashDirectory(distDirectory, EXPECTED_APP_FILES);
  const lockfileSha256 = sha256(
    await readFile(join(PROJECT_ROOT, 'pnpm-lock.yaml'))
  );

  /** @type {Map<string, Record<string, any>>} */
  const components = new Map();
  /** @type {Map<string, Set<string>>} */
  const dependencyGraph = new Map();
  const traversedEdges = new Set();
  const applicationRef = npmPurl(pkgJson.name, pkgJson.version);

  /**
   * @param {string} parentRef
   * @param {Record<string, any> | undefined} dependencies
   * @param {'required' | 'excluded'} scope
   */
  function collectDependencies(parentRef, dependencies, scope) {
    const children = dependencyGraph.get(parentRef) ?? new Set();
    dependencyGraph.set(parentRef, children);
    for (const [name, dependency] of Object.entries(dependencies ?? {})) {
      if (!dependency || typeof dependency.version !== 'string') {
        throw new Error(`Missing version for dependency ${name}`);
      }
      const packageName =
        typeof dependency.from === 'string' ? dependency.from : name;
      const key = `${packageName}@${dependency.version}`;
      const purl = npmPurl(packageName, dependency.version);
      children.add(purl);
      const existing = components.get(purl);
      if (!existing) {
        components.set(purl, {
          type: 'library',
          'bom-ref': purl,
          name: packageName,
          version: dependency.version,
          scope,
          purl,
          ...(licenseChoice(licenses.get(key))
            ? { licenses: licenseChoice(licenses.get(key)) }
            : {}),
          ...(typeof dependency.resolved === 'string' &&
          dependency.resolved.startsWith('https://')
            ? {
                externalReferences: [
                  { type: 'distribution', url: dependency.resolved }
                ]
              }
            : {}),
          ...(packageName !== name
            ? {
                properties: [{ name: 'ytaf:dependency-alias', value: name }]
              }
            : {})
        });
      } else if (scope === 'required') {
        existing.scope = 'required';
      }

      const edge = `${parentRef}\0${purl}`;
      if (traversedEdges.has(edge)) continue;
      traversedEdges.add(edge);
      collectDependencies(purl, dependency.dependencies, scope);
    }
  }

  collectDependencies(applicationRef, dependencyTree.dependencies, 'required');
  collectDependencies(
    applicationRef,
    dependencyTree.devDependencies,
    'excluded'
  );

  for (const vendor of [
    {
      repository: 'WICG/spatial-navigation',
      name: 'WICG Spatial Navigation Polyfill',
      upstreamCommit: '183f0146b6741007e46fa64ab0950447defdf8af',
      path: 'src/spatial-navigation-polyfill.js'
    },
    {
      repository: 'Financial-Times/polyfill-library',
      name: 'Financial Times Polyfill Library DOMRect',
      upstreamCommit: 'c25c30e4463bef60fba1213ecb697f3e3f253d7b',
      path: 'src/domrect-polyfill.js'
    }
  ]) {
    // The two bounded vendored files are hashed sequentially for deterministic IO.
    // eslint-disable-next-line no-await-in-loop
    const source = await readFile(join(PROJECT_ROOT, vendor.path));
    const localHash = sha256(source);
    const ancestorPurl = `pkg:github/${vendor.repository}@${vendor.upstreamCommit}`;
    const localRef = `urn:ytaf:vendored:${encodeURIComponent(vendor.path)}:sha256:${localHash}`;
    components.set(localRef, {
      type: 'library',
      'bom-ref': localRef,
      name: vendor.name,
      version: `${vendor.upstreamCommit}+ytaf.${localHash.slice(0, 12)}`,
      scope: 'required',
      licenses: [{ license: { id: 'MIT' } }],
      hashes: [{ alg: 'SHA-256', content: localHash }],
      pedigree: {
        ancestors: [
          {
            type: 'library',
            name: vendor.name,
            version: vendor.upstreamCommit,
            purl: ancestorPurl
          }
        ]
      },
      externalReferences: [
        {
          type: 'vcs',
          url: `https://github.com/${vendor.repository}/tree/${vendor.upstreamCommit}`
        }
      ],
      properties: [
        { name: 'ytaf:vendored-path', value: vendor.path },
        { name: 'ytaf:locally-modified', value: 'true' },
        {
          name: 'ytaf:patch-documentation',
          value: 'docs/vendor-patches.md'
        }
      ]
    });
    dependencyGraph.get(applicationRef)?.add(localRef);
    dependencyGraph.set(localRef, new Set());
  }

  const sortedComponents = [...components.values()].sort((left, right) =>
    left['bom-ref'].localeCompare(right['bom-ref'])
  );
  assertRuntimeNotices(
    sortedComponents,
    await readFile(join(PROJECT_ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8')
  );
  const serialSeed = [
    provenance.sourceTreeSha256,
    distTreeSha256,
    lockfileSha256,
    ...sortedComponents.map((component) => component['bom-ref'])
  ].join('\n');
  const sbom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${deterministicUuid(serialSeed)}`,
    version: 1,
    metadata: {
      tools: {
        components: [
          {
            type: 'application',
            name: 'Node.js',
            version: process.versions.node,
            purl: `pkg:generic/node@${process.versions.node}`
          },
          {
            type: 'application',
            name: 'pnpm',
            version: pnpmVersion,
            purl: npmPurl('pnpm', pnpmVersion)
          }
        ]
      },
      component: {
        type: 'application',
        'bom-ref': applicationRef,
        name: pkgJson.name,
        version: pkgJson.version,
        purl: applicationRef,
        licenses: [{ license: { id: 'GPL-3.0-only' } }],
        externalReferences: [{ type: 'vcs', url: REPOSITORY_URL }]
      },
      properties: [
        { name: 'ytaf:build-mode', value: provenance.mode },
        { name: 'ytaf:dirty', value: String(provenance.dirty) },
        { name: 'ytaf:git-commit', value: provenance.commit },
        { name: 'ytaf:git-tree', value: provenance.gitTree },
        {
          name: 'ytaf:source-tree-sha256',
          value: provenance.sourceTreeSha256
        },
        { name: 'ytaf:dist-tree-sha256', value: distTreeSha256 },
        { name: 'ytaf:pnpm-lock-sha256', value: lockfileSha256 }
      ]
    },
    components: sortedComponents,
    dependencies: [...dependencyGraph.entries()]
      .map(([ref, dependsOn]) => ({ ref, dependsOn: [...dependsOn].sort() }))
      .sort((left, right) => left.ref.localeCompare(right.ref))
  };

  await writeFileAtomic(outputPath, `${JSON.stringify(sbom, null, 2)}\n`);
  if (!options.quiet) {
    console.info(
      `Created ${outputPath} with ${components.size} complete runtime/build components`
    );
  }
  return sbom;
}

const isCommand =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isCommand) {
  await generateSbom({ mode: parseBuildMode() });
}
