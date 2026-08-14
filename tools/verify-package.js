import { execFileSync } from 'node:child_process';
import { mkdtemp, lstat, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Parser as TarParser } from 'tar';

import appInfoSource from '../assets/appinfo.json' with { type: 'json' };
import pkgJson from '../package.json' with { type: 'json' };
import { generateSbom } from './gen-sbom.js';
import {
  APP_ID,
  DIST_DIRECTORY,
  EXPECTED_APP_FILES,
  EXPECTED_AR_MEMBERS,
  PACKAGE_LIMITS,
  PROJECT_ROOT,
  artifactNames,
  assertAppInfo,
  assertPackageMetadata,
  assertSafeRelativePath,
  controlContent,
  hashDirectory,
  listRelativeFiles,
  packageInfoContent,
  parseBuildMode,
  sha256
} from './package-contract.js';
import { createPackage } from './package.js';

/** @param {string[]} actual @param {readonly string[]} expected @param {string} context */
function assertExactFiles(actual, expected, context) {
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    throw new Error(
      `${context} content mismatch; actual=[${sortedActual.join(', ')}], expected=[${sortedExpected.join(', ')}]`
    );
  }
}

/** @param {string} path @param {number} maximumBytes */
async function readBoundedRegularFile(path, maximumBytes) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Expected a regular file: ${path}`);
  }
  if (metadata.size > maximumBytes) {
    throw new Error(`File exceeds ${maximumBytes} bytes: ${path}`);
  }
  return readFile(path);
}

/** @param {Buffer} archive */
function parseAr(archive) {
  if (archive.length > PACKAGE_LIMITS.ipkBytes) {
    throw new Error('IPK exceeds the compressed size limit');
  }
  if (archive.subarray(0, 8).toString('ascii') !== '!<arch>\n') {
    throw new Error('Invalid ar archive signature');
  }
  const members = new Map();
  let offset = 8;
  while (offset < archive.length) {
    if (archive.length - offset < 60) {
      throw new Error('Truncated ar member header');
    }
    const header = archive.subarray(offset, offset + 60);
    if (header.subarray(58).toString('ascii') !== '`\n') {
      throw new Error('Invalid ar member header');
    }
    const name = header.subarray(0, 16).toString('ascii').trim();
    const timestamp = header.subarray(16, 28).toString('ascii').trim();
    const owner = header.subarray(28, 34).toString('ascii').trim();
    const group = header.subarray(34, 40).toString('ascii').trim();
    const mode = header.subarray(40, 48).toString('ascii').trim();
    const sizeText = header.subarray(48, 58).toString('ascii').trim();
    if (
      timestamp !== '0' ||
      owner !== '0' ||
      group !== '0' ||
      mode !== '100644'
    ) {
      throw new Error(`Non-reproducible ar metadata for ${name}`);
    }
    if (!/^\d+$/.test(sizeText)) throw new Error('Invalid ar member size');
    const size = Number(sizeText);
    const start = offset + 60;
    const end = start + size;
    if (
      !Number.isSafeInteger(size) ||
      size > PACKAGE_LIMITS.compressedMemberBytes ||
      end > archive.length
    ) {
      throw new Error(`Invalid or oversized ar member: ${name}`);
    }
    if (members.has(name)) throw new Error(`Duplicate ar member: ${name}`);
    members.set(name, archive.subarray(start, end));
    offset = end + (size % 2);
  }
  if (offset !== archive.length) throw new Error('Invalid ar trailing data');
  assertExactFiles([...members.keys()], EXPECTED_AR_MEMBERS, 'ar archive');
  return members;
}

/**
 * @param {Buffer} archive
 * @param {{ context: string, maximumBytes: number }} options
 * @returns {Promise<Map<string, Buffer>>}
 */
function parseTar(archive, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    /** @type {Map<string, Buffer>} */
    const files = new Map();
    const entries = new Set();
    /** @type {Promise<void>[]} */
    const pendingEntries = [];
    let declaredBytes = 0;
    let settled = false;
    /** @type {TarParser} */
    let parser;

    /** @param {unknown} cause */
    const reject = (cause) => {
      if (settled) return;
      settled = true;
      const error =
        cause instanceof Error ? cause : new Error(String(cause ?? 'error'));
      rejectPromise(error);
    };

    /** @param {Error} error */
    const abort = (error) => {
      try {
        parser.abort(error);
      } catch (cause) {
        reject(cause);
      }
    };

    parser = new TarParser({
      strict: true,
      maxDecompressionRatio: 100,
      maxMetaEntrySize: 4096,
      onReadEntry(entry) {
        const rawPath = entry.path;
        const path = rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
        try {
          assertSafeRelativePath(path);
          if (entries.has(path))
            throw new Error(`Duplicate tar entry: ${path}`);
          entries.add(path);
          if (entries.size > PACKAGE_LIMITS.entries) {
            throw new Error(`${options.context} has too many entries`);
          }
          if ((entry.mode ?? 0) & 0o7000) {
            throw new Error(`${options.context} contains privileged mode bits`);
          }
          if (entry.type === 'Directory') {
            if (entry.size !== 0) {
              throw new Error(`Directory has a body: ${path}`);
            }
            entry.resume();
            return;
          }
          if (entry.type !== 'File' || entry.linkpath) {
            throw new Error(`Unsupported tar entry type at ${path}`);
          }
          if (
            !Number.isSafeInteger(entry.size) ||
            entry.size < 0 ||
            entry.size > PACKAGE_LIMITS.fileBytes
          ) {
            throw new Error(`Oversized tar file: ${path}`);
          }
          declaredBytes += entry.size;
          if (declaredBytes > options.maximumBytes) {
            throw new Error(
              `${options.context} exceeds its expanded size limit`
            );
          }

          pendingEntries.push(
            new Promise((resolveEntry, rejectEntry) => {
              /** @type {Buffer[]} */
              const chunks = [];
              let actualBytes = 0;
              entry.on('data', (chunk) => {
                actualBytes += chunk.length;
                if (
                  actualBytes > entry.size ||
                  actualBytes > PACKAGE_LIMITS.fileBytes
                ) {
                  const error = new Error(
                    `Tar file body exceeds header: ${path}`
                  );
                  rejectEntry(error);
                  abort(error);
                  return;
                }
                chunks.push(chunk);
              });
              entry.on('error', rejectEntry);
              entry.on('end', () => {
                if (actualBytes !== entry.size) {
                  rejectEntry(new Error(`Truncated tar file: ${path}`));
                  return;
                }
                files.set(path, Buffer.concat(chunks, actualBytes));
                resolveEntry();
              });
            })
          );
        } catch (error) {
          entry.resume();
          abort(error instanceof Error ? error : new Error(String(error)));
        }
      }
    });
    parser.once('abort', reject);
    parser.once('error', reject);
    parser.once('meta', () =>
      abort(
        new Error(`${options.context} contains unexpected metadata entries`)
      )
    );
    parser.once('end', async () => {
      try {
        await Promise.all(pendingEntries);
        if (!settled) {
          settled = true;
          resolvePromise(files);
        }
      } catch (error) {
        reject(error);
      }
    });
    try {
      parser.end(archive);
    } catch (error) {
      reject(error);
    }
  });
}

/** @param {string} leftDirectory @param {string} rightDirectory @param {readonly string[]} files */
async function assertDirectoriesEqual(leftDirectory, rightDirectory, files) {
  assertExactFiles(
    await listRelativeFiles(leftDirectory),
    files,
    'checked dist directory'
  );
  assertExactFiles(
    await listRelativeFiles(rightDirectory),
    files,
    'fresh dist directory'
  );
  for (const file of [...files].sort()) {
    // Byte comparison is intentionally sequential and stops at the first drift.
    // eslint-disable-next-line no-await-in-loop
    const [left, right] = await Promise.all([
      readFile(join(leftDirectory, ...file.split('/'))),
      readFile(join(rightDirectory, ...file.split('/')))
    ]);
    if (!left.equals(right)) {
      throw new Error(`dist differs from a fresh source build: ${file}`);
    }
  }
}

/** @param {string} actualPath @param {string} expectedPath @param {number} maximumBytes */
async function assertFilesEqual(actualPath, expectedPath, maximumBytes) {
  const [actual, expected] = await Promise.all([
    readBoundedRegularFile(actualPath, maximumBytes),
    readBoundedRegularFile(expectedPath, maximumBytes)
  ]);
  if (!actual.equals(expected)) {
    throw new Error(
      `Artifact differs from its reproducible build: ${actualPath}`
    );
  }
  return actual;
}

/** @param {unknown} value */
function validateSbom(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SBOM root must be an object');
  }
  const sbom = /** @type {Record<string, any>} */ (value);
  if (
    sbom.bomFormat !== 'CycloneDX' ||
    sbom.specVersion !== '1.5' ||
    !/^urn:uuid:[0-9a-f-]{36}$/.test(sbom.serialNumber)
  ) {
    throw new Error('Unexpected CycloneDX document contract');
  }
  if (!Array.isArray(sbom.components) || !Array.isArray(sbom.dependencies)) {
    throw new Error('SBOM component and dependency graphs are required');
  }
  const components = /** @type {Record<string, any>[]} */ (sbom.components);
  const rootRef = sbom.metadata?.component?.['bom-ref'];
  if (typeof rootRef !== 'string')
    throw new Error('SBOM root reference missing');
  const refs = new Set([rootRef]);
  for (const component of components) {
    const ref = component?.['bom-ref'];
    if (typeof ref !== 'string' || refs.has(ref)) {
      throw new Error(`Duplicate or invalid SBOM reference: ${String(ref)}`);
    }
    if (!Array.isArray(component.licenses) || component.licenses.length === 0) {
      throw new Error(`SBOM component license is missing: ${String(ref)}`);
    }
    refs.add(ref);
    if (
      component.name === 'node' ||
      component.name === 'node-bin-setup' ||
      /^node-bin-/.test(component.name ?? '')
    ) {
      throw new Error('SBOM contains a dynamically downloaded Node runtime');
    }
  }
  for (const dependency of sbom.dependencies) {
    if (!refs.has(dependency?.ref) || !Array.isArray(dependency.dependsOn)) {
      throw new Error('SBOM dependency graph contains an invalid node');
    }
    for (const child of dependency.dependsOn) {
      if (!refs.has(child)) {
        throw new Error(`SBOM dependency graph references ${String(child)}`);
      }
    }
  }
  if (
    !components.some(
      (component) =>
        component.name === '@babel/runtime-corejs3' &&
        component.purl?.startsWith('pkg:npm/%40babel/runtime-corejs3@')
    )
  ) {
    throw new Error('SBOM does not contain the canonical scoped npm PURL');
  }
  const vendored = components.filter((component) =>
    String(component['bom-ref']).startsWith('urn:ytaf:vendored:')
  );
  if (
    vendored.length !== 2 ||
    vendored.some((component) => {
      const properties = /** @type {Array<Record<string, unknown>>} */ (
        Array.isArray(component.properties) ? component.properties : []
      );
      return (
        properties.find((property) => property.name === 'ytaf:locally-modified')
          ?.value !== 'true' || !component.pedigree?.ancestors?.length
      );
    })
  ) {
    throw new Error('SBOM vendored-code pedigree is incomplete');
  }
}

/** @param {Map<string, Buffer>} dataFiles @param {Map<string, Buffer>} controlFiles @param {string} distDirectory */
async function validateArchivePayload(dataFiles, controlFiles, distDirectory) {
  const appPrefix = `usr/palm/applications/${APP_ID}`;
  const packageInfoPath = `usr/palm/packages/${APP_ID}/packageinfo.json`;
  const expectedDataFiles = [
    ...EXPECTED_APP_FILES.map((file) => `${appPrefix}/${file}`),
    packageInfoPath
  ];
  assertExactFiles(
    [...dataFiles.keys()].sort(),
    expectedDataFiles,
    'IPK data archive'
  );
  assertExactFiles(
    [...controlFiles.keys()].sort(),
    ['control'],
    'control archive'
  );

  for (const file of EXPECTED_APP_FILES) {
    const packaged = dataFiles.get(`${appPrefix}/${file}`);
    // eslint-disable-next-line no-await-in-loop
    const built = await readFile(join(distDirectory, ...file.split('/')));
    if (!packaged?.equals(built)) {
      throw new Error(`Packaged application differs from dist: ${file}`);
    }
  }

  const packagedInfo = dataFiles.get(packageInfoPath);
  const expectedPackageInfo = packageInfoContent(appInfoSource);
  if (packagedInfo?.toString('utf8') !== expectedPackageInfo) {
    throw new Error('Unexpected packageinfo.json');
  }
  const installedSize = Math.ceil(
    [...dataFiles.values()].reduce((total, value) => total + value.length, 0) /
      1024
  );
  if (
    controlFiles.get('control')?.toString('utf8') !==
    controlContent(appInfoSource, installedSize)
  ) {
    throw new Error('Unexpected package control metadata');
  }
}

/** @param {{ mode?: 'release' | 'development', artifactDirectory?: string }} [options] */
export async function verifyPackage(options = {}) {
  assertPackageMetadata(pkgJson);
  assertAppInfo(appInfoSource, pkgJson.version);
  const mode = options.mode ?? 'release';
  const artifactDirectory = resolve(options.artifactDirectory ?? PROJECT_ROOT);
  const names = artifactNames(pkgJson.version);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ytaf-verify-'));
  try {
    const freshDist = join(temporaryDirectory, 'fresh build with spaces');
    const webpackCli = join(
      PROJECT_ROOT,
      'node_modules',
      'webpack',
      'bin',
      'webpack.js'
    );
    execFileSync(
      process.execPath,
      [webpackCli, '--mode=production', '--env', `outputPath=${freshDist}`],
      { cwd: PROJECT_ROOT, shell: false, stdio: 'inherit' }
    );
    await assertDirectoriesEqual(DIST_DIRECTORY, freshDist, EXPECTED_APP_FILES);

    const expectedSbomPath = join(temporaryDirectory, names.sbom);
    await generateSbom({
      mode,
      outputPath: expectedSbomPath,
      distDirectory: freshDist,
      quiet: true
    });
    const expectedArtifactsDirectory = join(
      temporaryDirectory,
      'expected artifacts with spaces'
    );
    await createPackage({
      mode,
      distDirectory: freshDist,
      sbomPath: expectedSbomPath,
      outputDirectory: expectedArtifactsDirectory,
      quiet: true
    });

    const sbomBytes = await assertFilesEqual(
      join(artifactDirectory, names.sbom),
      expectedSbomPath,
      PACKAGE_LIMITS.dataArchiveBytes
    );
    validateSbom(JSON.parse(sbomBytes.toString('utf8')));

    const comparisonLimits = new Map([
      [names.ipk, PACKAGE_LIMITS.ipkBytes],
      [names.manifest, 256 * 1024],
      [names.provenance, 256 * 1024],
      [names.checksums, 64 * 1024]
    ]);
    /** @type {Map<string, Buffer>} */
    const verifiedArtifacts = new Map();
    for (const [name, maximumBytes] of comparisonLimits) {
      // Rebuilding every artifact authenticates it against the current source.
      // eslint-disable-next-line no-await-in-loop
      const bytes = await assertFilesEqual(
        join(artifactDirectory, name),
        join(expectedArtifactsDirectory, name),
        maximumBytes
      );
      verifiedArtifacts.set(name, bytes);
    }

    const archive = verifiedArtifacts.get(names.ipk);
    if (!archive) throw new Error('Verified IPK bytes are missing');
    const members = parseAr(archive);
    if (members.get('debian-binary')?.toString('utf8') !== '2.0\n') {
      throw new Error('Unsupported debian-binary member');
    }
    const dataArchive = members.get('data.tar.gz');
    const controlArchive = members.get('control.tar.gz');
    if (!dataArchive || !controlArchive)
      throw new Error('IPK tar members missing');
    const [dataFiles, controlFiles] = await Promise.all([
      parseTar(dataArchive, {
        context: 'data archive',
        maximumBytes: PACKAGE_LIMITS.dataArchiveBytes
      }),
      parseTar(controlArchive, {
        context: 'control archive',
        maximumBytes: PACKAGE_LIMITS.controlArchiveBytes
      })
    ]);
    await validateArchivePayload(dataFiles, controlFiles, freshDist);

    const manifestBytes = verifiedArtifacts.get(names.manifest);
    const provenanceBytes = verifiedArtifacts.get(names.provenance);
    const checksumBytes = verifiedArtifacts.get(names.checksums);
    if (!manifestBytes || !provenanceBytes || !checksumBytes) {
      throw new Error('Release evidence is incomplete');
    }
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    const qaEvidence = manifest.releaseEvidence?.qa;
    if (
      manifest.ipkHash?.sha256 !== sha256(archive) ||
      manifest.releaseEvidence?.sbom?.sha256 !== sha256(sbomBytes) ||
      manifest.releaseEvidence?.mode !== mode ||
      manifest.releaseEvidence?.distTreeSha256 !==
        (await hashDirectory(freshDist, EXPECTED_APP_FILES)) ||
      qaEvidence?.sourceTreeSha256 !==
        manifest.releaseEvidence?.sourceTreeSha256 ||
      qaEvidence?.distTreeSha256 !== manifest.releaseEvidence?.distTreeSha256
    ) {
      throw new Error('Manifest hashes or build provenance are invalid');
    }
    const provenance = JSON.parse(provenanceBytes.toString('utf8'));
    if (
      JSON.stringify(provenance.predicate?.runDetails?.metadata?.qa) !==
      JSON.stringify(qaEvidence)
    ) {
      throw new Error('Provenance does not bind the QA receipt');
    }
    const provenanceSubjects =
      /** @type {Array<{ name?: unknown, digest?: { sha256?: unknown } }>} */ (
        Array.isArray(provenance.subject) ? provenance.subject : []
      );
    const subjects = new Map(
      provenanceSubjects.map((subject) => [
        subject.name,
        subject.digest?.sha256
      ])
    );
    if (
      subjects.get(names.ipk) !== sha256(archive) ||
      subjects.get(names.manifest) !== sha256(manifestBytes) ||
      subjects.get(names.sbom) !== sha256(sbomBytes)
    ) {
      throw new Error('Provenance statement does not bind every release input');
    }
    if (
      !checksumBytes
        .toString('utf8')
        .includes(`${sha256(provenanceBytes)}  ${names.provenance}`)
    ) {
      throw new Error('Checksum index does not bind the provenance statement');
    }

    const sourceAppInfo = await readFile(
      join(PROJECT_ROOT, 'assets', 'appinfo.json')
    );
    const packagedAppInfo = dataFiles.get(
      `usr/palm/applications/${APP_ID}/appinfo.json`
    );
    const freshAppInfo = await readFile(join(freshDist, 'appinfo.json'));
    if (
      !packagedAppInfo?.equals(freshAppInfo) ||
      JSON.stringify(JSON.parse(sourceAppInfo.toString('utf8'))) !==
        JSON.stringify(JSON.parse(freshAppInfo.toString('utf8')))
    ) {
      throw new Error('Packaged appinfo.json differs from reviewed source');
    }

    console.info(
      `Verified ${names.ipk} (${sha256(archive)}) from a fresh source build in ${mode} mode`
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

const isCommand =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isCommand) {
  await verifyPackage({ mode: parseBuildMode() });
}
