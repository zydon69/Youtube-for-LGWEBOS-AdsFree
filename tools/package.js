import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { create as createTar } from 'tar';

import pkgJson from '../package.json' with { type: 'json' };

const projectRoot = new URL('../', import.meta.url);
const distDir = new URL('../dist/', import.meta.url);

/** @param {string} path @returns {Promise<number>} */
async function directorySize(path) {
  const entries = await readdir(path, { withFileTypes: true });
  /** @type {number[]} */
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(path, entry.name);
      return entry.isDirectory()
        ? directorySize(entryPath)
        : (await stat(entryPath)).size;
    })
  );
  return sizes.reduce((total, size) => total + size, 0);
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

async function createPackage() {
  const appInfoPath = new URL('appinfo.json', distDir);
  const appInfo = JSON.parse(await readFile(appInfoPath, 'utf8'));
  if (
    !appInfo ||
    typeof appInfo.id !== 'string' ||
    typeof appInfo.version !== 'string'
  ) {
    throw new Error(
      'dist/appinfo.json must contain string id and version fields'
    );
  }
  if (appInfo.version !== pkgJson.version) {
    throw new Error('dist/appinfo.json version does not match package.json');
  }

  const workDir = await mkdtemp(join(tmpdir(), 'youtube-webos-package-'));
  try {
    const controlDir = join(workDir, 'control');
    const dataDir = join(workDir, 'data');
    const appDir = join(dataDir, 'usr', 'palm', 'applications', appInfo.id);
    const packageDir = join(dataDir, 'usr', 'palm', 'packages', appInfo.id);
    await Promise.all([
      mkdir(controlDir, { recursive: true }),
      mkdir(appDir, { recursive: true }),
      mkdir(packageDir, { recursive: true })
    ]);

    await cp(distDir, appDir, { recursive: true });
    await writeFile(
      join(packageDir, 'packageinfo.json'),
      `${JSON.stringify(
        { id: appInfo.id, version: appInfo.version, app: appInfo.id },
        null,
        2
      )}\n`
    );

    const installedSize = await directorySize(dataDir);
    const control = [
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
    await writeFile(join(controlDir, 'control'), control);

    const controlTar = join(workDir, 'control.tar.gz');
    const dataTar = join(workDir, 'data.tar.gz');
    await createTar(
      { cwd: controlDir, file: controlTar, gzip: true, portable: true },
      ['control']
    );
    await createTar(
      { cwd: dataDir, file: dataTar, gzip: true, portable: true },
      ['usr']
    );

    const outputName = `${appInfo.id}_${appInfo.version}_all.ipk`;
    const outputPath = new URL(outputName, projectRoot);
    const archive = Buffer.concat([
      Buffer.from('!<arch>\n', 'ascii'),
      createArMember('debian-binary', Buffer.from('2.0\n', 'ascii')),
      createArMember('control.tar.gz', await readFile(controlTar)),
      createArMember('data.tar.gz', await readFile(dataTar))
    ]);
    await writeFile(outputPath, archive);
    console.info(`Created ${basename(outputPath.pathname)}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

await createPackage();
