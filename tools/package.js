import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { create as createTar } from 'tar';

import pkgJson from '../package.json' with { type: 'json' };
import {
  DIST_DIRECTORY,
  EXPECTED_APP_FILES,
  PROJECT_ROOT,
  artifactNames,
  assertAppInfo,
  assertPackageMetadata,
  controlContent,
  createManifest,
  createProvenanceStatement,
  formatChecksums,
  getBuildProvenance,
  hashDirectory,
  listRelativeFiles,
  packageInfoContent,
  parseBuildMode,
  sha256,
  writeFileAtomic
} from './package-contract.js';

const SOURCE_DATE = new Date('2000-01-01T00:00:00.000Z');

/** @param {string[]} actual @param {readonly string[]} expected @param {string} context */
function assertExactFiles(actual, expected, context) {
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    throw new Error(
      `${context} content mismatch; actual=[${actual.join(', ')}], expected=[${sortedExpected.join(', ')}]`
    );
  }
}

/** @param {string} directory */
async function validateDist(directory) {
  assertExactFiles(
    await listRelativeFiles(directory),
    EXPECTED_APP_FILES,
    'dist'
  );
}

/** @param {string} directory */
async function directorySize(directory) {
  const files = await listRelativeFiles(directory);
  let size = 0;
  for (const file of files) {
    // Files are read in canonical order to make failures deterministic.
    // eslint-disable-next-line no-await-in-loop
    size += (await stat(join(directory, ...file.split('/')))).size;
  }
  return size;
}

/** @param {string | number} value @param {number} length */
function pad(value, length) {
  const stringValue = String(value);
  if (stringValue.length > length) {
    throw new Error(`ar header value "${stringValue}" exceeds ${length} bytes`);
  }
  return stringValue.padEnd(length, ' ');
}

/** @param {string} name @param {Buffer} data */
function createArMember(name, data) {
  const header = Buffer.from(
    `${pad(name, 16)}${pad(0, 12)}${pad(0, 6)}${pad(0, 6)}${pad('100644', 8)}${pad(data.length, 10)}` +
      '`\n',
    'ascii'
  );
  const padding = data.length % 2 === 0 ? Buffer.alloc(0) : Buffer.from('\n');
  return Buffer.concat([header, data, padding]);
}

/** @param {unknown} sbom @param {Awaited<ReturnType<typeof getBuildProvenance>>} provenance @param {string} distTreeSha256 */
function assertSbomProvenance(sbom, provenance, distTreeSha256) {
  if (!sbom || typeof sbom !== 'object' || Array.isArray(sbom)) {
    throw new Error('SBOM must contain an object');
  }
  const metadata = /** @type {Record<string, any>} */ (sbom).metadata;
  const properties = /** @type {Array<{ name?: unknown, value?: unknown }>} */ (
    Array.isArray(metadata?.properties) ? metadata.properties : []
  );
  const values = new Map();
  for (const property of properties) {
    if (
      typeof property.name === 'string' &&
      typeof property.value === 'string'
    ) {
      values.set(property.name, property.value);
    }
  }
  if (
    values.get('ytaf:git-commit') !== provenance.commit ||
    values.get('ytaf:git-tree') !== provenance.gitTree ||
    values.get('ytaf:source-tree-sha256') !== provenance.sourceTreeSha256 ||
    values.get('ytaf:dist-tree-sha256') !== distTreeSha256 ||
    values.get('ytaf:build-mode') !== provenance.mode ||
    values.get('ytaf:dirty') !== String(provenance.dirty)
  ) {
    throw new Error('SBOM provenance does not match the package inputs');
  }
}

/**
 * @param {{
 *   mode?: 'release' | 'development',
 *   distDirectory?: string,
 *   outputDirectory?: string,
 *   sbomPath?: string,
 *   quiet?: boolean
 * }} [options]
 */
export async function createPackage(options = {}) {
  assertPackageMetadata(pkgJson);
  const mode = options.mode ?? 'release';
  const distDirectory = resolve(options.distDirectory ?? DIST_DIRECTORY);
  const outputDirectory = resolve(options.outputDirectory ?? PROJECT_ROOT);
  const sbomPath = resolve(
    options.sbomPath ?? join(PROJECT_ROOT, 'sbom.cdx.json')
  );
  await validateDist(distDirectory);

  const appInfo = assertAppInfo(
    JSON.parse(await readFile(join(distDirectory, 'appinfo.json'), 'utf8')),
    pkgJson.version
  );
  const provenance = await getBuildProvenance(mode);
  const distTreeSha256 = await hashDirectory(distDirectory, EXPECTED_APP_FILES);
  const sbom = JSON.parse(await readFile(sbomPath, 'utf8'));
  assertSbomProvenance(sbom, provenance, distTreeSha256);
  const sbomBytes = await readFile(sbomPath);
  const names = artifactNames(pkgJson.version);

  const workDirectory = await mkdtemp(join(tmpdir(), 'youtube-webos-package-'));
  try {
    const controlDirectory = join(workDirectory, 'control');
    const dataDirectory = join(workDirectory, 'data');
    const appDirectory = join(
      dataDirectory,
      'usr',
      'palm',
      'applications',
      appInfo.id
    );
    const packageDirectory = join(
      dataDirectory,
      'usr',
      'palm',
      'packages',
      appInfo.id
    );
    await Promise.all([
      mkdir(controlDirectory, { recursive: true }),
      mkdir(appDirectory, { recursive: true }),
      mkdir(packageDirectory, { recursive: true }),
      mkdir(outputDirectory, { recursive: true })
    ]);

    await cp(distDirectory, appDirectory, {
      recursive: true,
      preserveTimestamps: false
    });
    await writeFile(
      join(packageDirectory, 'packageinfo.json'),
      packageInfoContent(appInfo),
      { mode: 0o644 }
    );

    const installedSize = Math.ceil(
      (await directorySize(dataDirectory)) / 1024
    );
    await writeFile(
      join(controlDirectory, 'control'),
      controlContent(appInfo, installedSize),
      { mode: 0o644 }
    );

    const controlTarPath = join(workDirectory, 'control.tar.gz');
    const dataTarPath = join(workDirectory, 'data.tar.gz');
    const tarOptions = {
      gzip: { level: 9 },
      portable: true,
      mtime: SOURCE_DATE,
      noPax: true
    };
    await createTar(
      { ...tarOptions, cwd: controlDirectory, file: controlTarPath },
      ['control']
    );
    await createTar({ ...tarOptions, cwd: dataDirectory, file: dataTarPath }, [
      'usr'
    ]);

    const archive = Buffer.concat([
      Buffer.from('!<arch>\n', 'ascii'),
      createArMember('debian-binary', Buffer.from('2.0\n', 'ascii')),
      createArMember('control.tar.gz', await readFile(controlTarPath)),
      createArMember('data.tar.gz', await readFile(dataTarPath))
    ]);
    const ipkSha256 = sha256(archive);
    const sbomSha256 = sha256(sbomBytes);
    const manifest = createManifest(appInfo, names, provenance, {
      ipk: ipkSha256,
      sbom: sbomSha256,
      distTree: distTreeSha256
    });
    const manifestBytes = Buffer.from(
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8'
    );
    const manifestSha256 = sha256(manifestBytes);
    const provenanceStatement = createProvenanceStatement(
      names,
      provenance,
      {
        ipk: ipkSha256,
        manifest: manifestSha256,
        sbom: sbomSha256,
        distTree: distTreeSha256
      },
      pkgJson.version
    );
    const provenanceBytes = Buffer.from(
      `${JSON.stringify(provenanceStatement, null, 2)}\n`,
      'utf8'
    );
    const checksumBytes = Buffer.from(
      formatChecksums({
        [names.ipk]: ipkSha256,
        [names.manifest]: manifestSha256,
        [names.sbom]: sbomSha256,
        [names.provenance]: sha256(provenanceBytes)
      }),
      'utf8'
    );

    const checksumPath = join(outputDirectory, names.checksums);
    // The checksum index is the transaction marker. Removing it first makes a
    // partially interrupted artifact refresh unverifiable and undeployable.
    await rm(checksumPath, { force: true });
    await writeFileAtomic(join(outputDirectory, names.ipk), archive);
    await writeFileAtomic(join(outputDirectory, names.manifest), manifestBytes);
    await writeFileAtomic(
      join(outputDirectory, names.provenance),
      provenanceBytes
    );
    await writeFileAtomic(checksumPath, checksumBytes);

    if (!options.quiet) {
      console.info(`Created ${basename(join(outputDirectory, names.ipk))}`);
      console.info(`SHA-256 ${ipkSha256}`);
      console.info(`Build mode ${mode}${provenance.dirty ? ' (dirty)' : ''}`);
    }
    return { names, provenance, ipkSha256, distTreeSha256 };
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}

const isCommand =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isCommand) {
  await createPackage({ mode: parseBuildMode() });
}
