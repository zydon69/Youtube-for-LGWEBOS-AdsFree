import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  lstat,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const DIST_DIRECTORY = join(PROJECT_ROOT, 'dist');
export const REQUIRED_NODE_MAJOR = 24;
export const APP_ID = 'youtube.leanback.v4';
export const APP_TITLE = 'YouTube AdFree';
export const REPOSITORY_URL =
  'https://github.com/zydon69/Youtube-for-LGWEBOS-AdsFree';
export const ARTIFACT_CONTRACT_VERSION = 1;

const WEBOS_VERSION_PATTERN =
  /^(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})$/;

const EXPECTED_APPINFO = Object.freeze({
  id: APP_ID,
  vendor: 'zydon69',
  type: 'web',
  main: 'index.html',
  title: APP_TITLE,
  icon: 'icon.png',
  largeIcon: 'largeIcon.png',
  mediumLargeIcon: 'mediumLargeIcon.png',
  extraLargeIcon: 'extraLargeIcon.png',
  playIcon: 'playIcon.png',
  iconColor: '#ff0000',
  splashBackground: 'splashBackground-v1.png',
  imageForRecents: 'imageForRecents.png',
  bgImage: 'bgImage.png',
  support360Content: true,
  checkUpdateOnLaunch: false,
  accessibility: { supportsAudioGuidance: true },
  vendorExtension: {
    userAgent:
      '$browserName$/$browserVersion$ ($platformName$-$platformVersion$), _TV_O18/$firmwareVersion$ (LG, $modelName$, $networkMode$)',
    allowCrossDomain: false
  },
  deeplinkingParams: '{"contentTarget":"v=$CONTENTID"}',
  inAppSearchParams: '{"target":"q=$SEARCH_KEYWORD"}',
  inAppVoiceIntent:
    '{"target":{"intent":"$INTENT","intentParam":"$INTENT_PARAM","languageCode":"$LANG_CODE"}}',
  supportQueryRouting: '{"amazonAlexa":true,"googleAssistant":true}',
  enablePigScreenSaver: false,
  trustLevel: 'netcast',
  privilegedJail: true,
  supportQuickStart: true,
  dialAppName: 'YouTube',
  disableBackHistoryAPI: true,
  supportGIP: true,
  wolwowlan: true
});

export const EXPECTED_APP_FILES = Object.freeze([
  'appinfo.json',
  'bgImage.png',
  'extraLargeIcon.png',
  'icon.png',
  'icon.svg',
  'imageForRecents.png',
  'index.html',
  'index.js',
  'largeIcon.png',
  'LICENSE',
  'mediumLargeIcon.png',
  'playIcon.png',
  'splashBackground-v1.png',
  'THIRD_PARTY_NOTICES.md',
  'webOSUserScripts/userScript.js',
  'webOSUserScripts/userScript.js.LICENSE.txt'
]);

export const EXPECTED_AR_MEMBERS = Object.freeze([
  'debian-binary',
  'control.tar.gz',
  'data.tar.gz'
]);

export const PACKAGE_LIMITS = Object.freeze({
  ipkBytes: 16 * 1024 * 1024,
  compressedMemberBytes: 12 * 1024 * 1024,
  dataArchiveBytes: 24 * 1024 * 1024,
  controlArchiveBytes: 64 * 1024,
  fileBytes: 12 * 1024 * 1024,
  entries: 64
});

export function assertBuildNode() {
  const actualNodeMajor = Number(process.versions.node.split('.')[0]);
  if (actualNodeMajor !== REQUIRED_NODE_MAJOR) {
    throw new Error(
      `Node.js ${REQUIRED_NODE_MAJOR}.x is required; found ${process.versions.node}. ` +
        'Install the runtime independently before running build tooling.'
    );
  }
}

assertBuildNode();

/** @param {Buffer | string} value */
export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** @param {string} path */
export async function hashFile(path) {
  return sha256(await readFile(path));
}

/** @param {string} value */
export function assertSafeRelativePath(value) {
  if (
    value.length === 0 ||
    value.includes('\0') ||
    value.includes('\\') ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value
      .split('/')
      .some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`Unsafe relative path: ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * @param {string} directory
 * @param {string} [prefix]
 * @returns {Promise<string[]>}
 */
export async function listRelativeFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      assertSafeRelativePath(relativePath);
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        return listRelativeFiles(absolutePath, relativePath);
      }
      if (!entry.isFile()) {
        throw new Error(`Unsupported filesystem entry: ${relativePath}`);
      }
      return [relativePath];
    })
  );
  return nestedFiles.flat().sort();
}

/** @param {string} directory @param {readonly string[]} [files] */
export async function hashDirectory(directory, files) {
  const relativeFiles = files
    ? [...files].sort()
    : await listRelativeFiles(directory);
  const digest = createHash('sha256');
  for (const file of relativeFiles) {
    assertSafeRelativePath(file);
    // Sequential reads make the canonical digest independent of filesystem order.
    // eslint-disable-next-line no-await-in-loop
    const content = await readFile(join(directory, ...file.split('/')));
    digest.update(file, 'utf8');
    digest.update('\0');
    digest.update(String(content.length), 'ascii');
    digest.update('\0');
    digest.update(sha256(content), 'ascii');
    digest.update('\n');
  }
  return digest.digest('hex');
}

/** @param {string[]} args */
function gitRaw(args) {
  return execFileSync('git', args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

/** @param {string[]} args */
function git(args) {
  return gitRaw(args).trim();
}

/** @param {string} value */
function normalizeRepositoryURL(value) {
  return value
    .trim()
    .replace(/^git@github\.com:/i, 'https://github.com/')
    .replace(/^ssh:\/\/git@github\.com\//i, 'https://github.com/')
    .replace(/\.git\/?$/i, '')
    .replace(/\/$/, '')
    .toLowerCase();
}

const buildInputPathspecs = Object.freeze([
  'src',
  'assets',
  'tools',
  'tests',
  '.browserslistrc',
  '.escheckrc',
  '.prettierrc.js',
  'babel.config.js',
  'eslint.config.ts',
  'package.json',
  'playwright.config.js',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'postcss.config.ts',
  'THIRD_PARTY_NOTICES.md',
  'LICENSE',
  'tsconfig.base.json',
  'tsconfig.json',
  'tsconfig.tooling.json',
  'webpack.config.js'
]);

/** @param {string} value @returns {string[]} */
function parseGitFileList(value) {
  return value.split('\0').filter(Boolean);
}

/** @returns {string[]} */
function ignoredBuildInputs() {
  return parseGitFileList(
    gitRaw([
      'ls-files',
      '-z',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--',
      ...buildInputPathspecs
    ])
  ).filter((file) => !file.endsWith('/.DS_Store'));
}

/** @param {string[]} ignoredInputs */
async function hashWorkingSourceTree(ignoredInputs) {
  const files = [
    ...new Set([
      ...parseGitFileList(
        gitRaw(['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
      ),
      ...ignoredInputs
    ])
  ].sort();
  const digest = createHash('sha256');
  for (const file of files) {
    assertSafeRelativePath(file);
    const absolutePath = resolve(PROJECT_ROOT, file);
    const expectedPrefix = `${resolve(PROJECT_ROOT)}${sep}`;
    if (!absolutePath.startsWith(expectedPrefix)) {
      throw new Error(`Source path escapes the repository: ${file}`);
    }
    let metadata;
    try {
      // Development evidence must represent tracked deletions rather than
      // failing before it can describe the dirty source tree.
      // eslint-disable-next-line no-await-in-loop
      metadata = await lstat(absolutePath);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        digest.update(file, 'utf8');
        digest.update('\0DELETED\n', 'ascii');
        continue;
      }
      throw error;
    }
    if (!metadata.isFile()) {
      throw new Error(`Unsupported tracked source entry: ${file}`);
    }
    // eslint-disable-next-line no-await-in-loop
    const content = await readFile(absolutePath);
    digest.update(file, 'utf8');
    digest.update('\0');
    digest.update(String(content.length), 'ascii');
    digest.update('\0');
    digest.update(sha256(content), 'ascii');
    digest.update('\n');
  }
  return digest.digest('hex');
}

/** @param {string[]} [args] */
export function parseBuildMode(args = process.argv.slice(2)) {
  const unsupported = args.filter((argument) => argument !== '--dev');
  if (unsupported.length > 0) {
    throw new Error(`Unsupported argument(s): ${unsupported.join(', ')}`);
  }
  return args.includes('--dev') ? 'development' : 'release';
}

/**
 * @param {{ branch: string, remoteURL: string, head: string, remoteHead: string, exactTag: string, tagSignatureValid: boolean, flagged: string[] }} snapshot
 * @param {string} expectedVersion
 */
export function assertReleaseState(snapshot, expectedVersion) {
  const expectedTag = `v${expectedVersion}`;
  if (snapshot.branch !== 'main') {
    throw new Error(
      `Release packaging requires main; found ${snapshot.branch}`
    );
  }
  if (
    normalizeRepositoryURL(snapshot.remoteURL) !==
    normalizeRepositoryURL(REPOSITORY_URL)
  ) {
    throw new Error(`Release origin does not match ${REPOSITORY_URL}`);
  }
  if (snapshot.remoteHead !== snapshot.head) {
    throw new Error('Release HEAD must exactly match the live origin/main');
  }
  if (snapshot.exactTag !== expectedTag) {
    throw new Error(`Release HEAD must carry the exact tag ${expectedTag}`);
  }
  if (!snapshot.tagSignatureValid) {
    throw new Error(`Release tag ${expectedTag} must have a valid signature`);
  }
  if (snapshot.flagged.length > 0) {
    throw new Error(
      `Release inputs use hidden Git index flags:\n${snapshot.flagged.slice(0, 20).join('\n')}`
    );
  }
}

/** @param {string} expectedVersion */
function assertReleaseGitState(expectedVersion) {
  const expectedTag = `v${expectedVersion}`;
  let tagSignatureValid = true;
  try {
    gitRaw(['verify-tag', expectedTag]);
  } catch {
    tagSignatureValid = false;
  }
  const remoteLine = git([
    'ls-remote',
    '--exit-code',
    'origin',
    'refs/heads/main'
  ]);
  assertReleaseState(
    {
      branch: git(['symbolic-ref', '--quiet', '--short', 'HEAD']),
      remoteURL: git(['config', '--get', 'remote.origin.url']),
      head: git(['rev-parse', 'HEAD']),
      remoteHead: remoteLine.split(/\s+/)[0] ?? '',
      exactTag: git(['describe', '--tags', '--exact-match', 'HEAD']),
      tagSignatureValid,
      flagged: gitRaw(['ls-files', '-v', '--', ...buildInputPathspecs])
        .split('\n')
        .filter((line) => /^[a-zS]/.test(line))
    },
    expectedVersion
  );
}

/** @param {'release' | 'development'} mode @param {string} [expectedVersion] */
export async function getBuildProvenance(mode, expectedVersion) {
  const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
  const ignoredInputs = ignoredBuildInputs();
  const dirty = status.length > 0 || ignoredInputs.length > 0;
  if (mode === 'release' && dirty) {
    const details = [
      ...status.split('\n').filter(Boolean),
      ...ignoredInputs.map((file) => `!! ${file}`)
    ];
    throw new Error(
      'Release packaging requires a clean Git tree. Use the explicitly marked ' +
        `development workflow for local artifacts.\n${details.slice(0, 20).join('\n')}`
    );
  }
  if (mode === 'release') {
    if (!expectedVersion) throw new Error('Release version is required');
    assertReleaseGitState(expectedVersion);
  }

  return Object.freeze({
    mode,
    dirty,
    commit: git(['rev-parse', 'HEAD']),
    gitTree: git(['rev-parse', 'HEAD^{tree}']),
    sourceTreeSha256: await hashWorkingSourceTree(ignoredInputs),
    repository: REPOSITORY_URL
  });
}

/** @param {unknown} value @param {string} packageVersion */
export function assertAppInfo(value, packageVersion) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('appinfo.json must contain an object');
  }
  const appInfo = /** @type {Record<string, unknown>} */ (value);
  assertWebOSVersion(packageVersion);
  if (appInfo.version !== packageVersion) {
    throw new Error('appinfo.json version must match package.json');
  }
  const expected = { ...EXPECTED_APPINFO, version: packageVersion };
  if (!isDeepStrictEqual(appInfo, expected)) {
    throw new Error(
      'appinfo.json does not exactly match the reviewed webOS metadata contract'
    );
  }
  return /** @type {Record<string, any>} */ (appInfo);
}

/** @param {unknown} version */
export function assertWebOSVersion(version) {
  if (typeof version !== 'string' || !WEBOS_VERSION_PATTERN.test(version)) {
    throw new Error(
      'webOS version must contain exactly three dot-separated integers, ' +
        'without leading zeroes and with at most nine digits per component'
    );
  }
  return version;
}

/** @param {{ version?: unknown, license?: unknown }} packageMetadata */
export function assertPackageMetadata(packageMetadata) {
  assertWebOSVersion(packageMetadata.version);
  if (packageMetadata.license !== 'GPL-3.0-only') {
    throw new Error('package.json license must remain GPL-3.0-only');
  }
}

/** @param {string} version */
export function artifactNames(version) {
  assertWebOSVersion(version);
  const ipk = `${APP_ID}_${version}_all.ipk`;
  return Object.freeze({
    ipk,
    manifest: `${APP_ID}.manifest.json`,
    sbom: 'sbom.cdx.json',
    provenance: `${APP_ID}_${version}_all.provenance.json`,
    checksums: `${APP_ID}_${version}_all.sha256`
  });
}

/** @param {string} path @param {Buffer | string} content */
export async function writeFileAtomic(path, content) {
  const temporaryPath = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, content, { flag: 'wx', mode: 0o644 });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

/**
 * @param {Record<string, any>} appInfo
 * @param {ReturnType<typeof artifactNames>} names
 * @param {{ mode: string, dirty: boolean, commit: string, gitTree: string, sourceTreeSha256: string }} provenance
 * @param {{ ipk: string, sbom: string, distTree: string }} hashes
 */
export function createManifest(appInfo, names, provenance, hashes) {
  return {
    artifactContractVersion: ARTIFACT_CONTRACT_VERSION,
    id: appInfo.id,
    version: appInfo.version,
    type: appInfo.type,
    title: appInfo.title,
    iconUri: `${REPOSITORY_URL.replace('github.com', 'raw.githubusercontent.com')}/${provenance.commit}/assets/largeIcon.png`,
    sourceUrl: `${REPOSITORY_URL}/tree/${provenance.commit}`,
    rootRequired: false,
    ipkUrl: names.ipk,
    ipkHash: { sha256: hashes.ipk },
    releaseEvidence: {
      mode: provenance.mode,
      dirty: provenance.dirty,
      commit: provenance.commit,
      gitTree: provenance.gitTree,
      sourceTreeSha256: provenance.sourceTreeSha256,
      distTreeSha256: hashes.distTree,
      sbom: { file: names.sbom, sha256: hashes.sbom },
      provenance: { file: names.provenance },
      checksums: { file: names.checksums }
    }
  };
}

/**
 * @param {ReturnType<typeof artifactNames>} names
 * @param {{ mode: string, dirty: boolean, commit: string, gitTree: string, sourceTreeSha256: string, repository: string }} provenance
 * @param {{ ipk: string, manifest: string, sbom: string, distTree: string }} hashes
 * @param {string} version
 */
export function createProvenanceStatement(names, provenance, hashes, version) {
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [
      { name: names.ipk, digest: { sha256: hashes.ipk } },
      { name: names.manifest, digest: { sha256: hashes.manifest } },
      { name: names.sbom, digest: { sha256: hashes.sbom } }
    ],
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: {
        buildType: `${REPOSITORY_URL}/blob/${provenance.commit}/tools/package.js`,
        externalParameters: {
          artifactContractVersion: ARTIFACT_CONTRACT_VERSION,
          mode: provenance.mode,
          applicationId: APP_ID,
          version
        },
        internalParameters: {
          dirty: provenance.dirty,
          sourceTreeSha256: provenance.sourceTreeSha256,
          distTreeSha256: hashes.distTree
        },
        resolvedDependencies: [
          {
            uri: `${provenance.repository}.git`,
            digest: {
              gitCommit: provenance.commit,
              gitTree: provenance.gitTree,
              sha256: provenance.sourceTreeSha256
            }
          }
        ]
      },
      runDetails: {
        builder: { id: `${REPOSITORY_URL}/tools/package.js` },
        metadata: { invocationId: hashes.ipk }
      }
    }
  };
}

/** @param {Record<string, string>} hashes */
export function formatChecksums(hashes) {
  return `${Object.entries(hashes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, hash]) => `${hash}  ${name}`)
    .join('\n')}\n`;
}

/** @param {Record<string, any>} appInfo */
export function packageInfoContent(appInfo) {
  return `${JSON.stringify(
    { id: appInfo.id, version: appInfo.version, app: appInfo.id },
    null,
    2
  )}\n`;
}

/** @param {Record<string, any>} appInfo @param {number} installedSize */
export function controlContent(appInfo, installedSize) {
  return [
    `Package: ${appInfo.id}`,
    `Version: ${appInfo.version}`,
    'Section: misc',
    'Priority: optional',
    'Architecture: all',
    `Installed-Size: ${installedSize}`,
    'Maintainer: zydon69 <noreply@github.com>',
    'Description: YouTube app for webOS TV with optional enhancements.',
    'webOS-Package-Format-Version: 2',
    'webOS-Packager-Version: youtube-webos',
    ''
  ].join('\n');
}
