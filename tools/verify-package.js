import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extract as extractTar } from 'tar';
import appInfoSource from '../assets/appinfo.json' with { type: 'json' };
import pkgJson from '../package.json' with { type: 'json' };

/** @param {Buffer} archive */
function parseAr(archive) {
  if (archive.subarray(0, 8).toString('ascii') !== '!<arch>\n') {
    throw new Error('Invalid ar archive signature');
  }
  const members = new Map();
  let offset = 8;
  while (offset < archive.length) {
    const header = archive.subarray(offset, offset + 60);
    if (header.length !== 60 || header.subarray(58).toString() !== '`\n') {
      throw new Error('Invalid ar member header');
    }
    const name = header.subarray(0, 16).toString('ascii').trim();
    const size = Number(header.subarray(48, 58).toString('ascii').trim());
    const start = offset + 60;
    members.set(name, archive.subarray(start, start + size));
    offset = start + size + (size % 2);
  }
  return members;
}

const ipkName = `${appInfoSource.id}_${pkgJson.version}_all.ipk`;
const archive = await readFile(ipkName);
const members = parseAr(archive);
if (members.get('debian-binary')?.toString() !== '2.0\n') {
  throw new Error('Unsupported debian-binary member');
}
const dataArchive = members.get('data.tar.gz');
if (!dataArchive) throw new Error('Missing data.tar.gz');

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ytaf-verify-'));
try {
  const dataPath = join(temporaryDirectory, 'data.tar.gz');
  await writeFile(dataPath, dataArchive);
  await extractTar({ cwd: temporaryDirectory, file: dataPath, strict: true });
  const appRoot = join(
    temporaryDirectory,
    'usr',
    'palm',
    'applications',
    appInfoSource.id
  );
  const appInfo = JSON.parse(
    await readFile(join(appRoot, 'appinfo.json'), 'utf8')
  );
  if (appInfo.version !== pkgJson.version)
    throw new Error('IPK version mismatch');
  if (appInfo.vendorExtension?.allowCrossDomain !== false) {
    throw new Error('allowCrossDomain must remain false');
  }
  const userScript = await readFile(
    join(appRoot, 'webOSUserScripts', 'userScript.js'),
    'utf8'
  );
  if (!userScript.includes('https://sponsor.ajay.app/api')) {
    throw new Error('Official SponsorBlock endpoint missing from IPK');
  }
  if (userScript.includes('sponsorblock.inf.re')) {
    throw new Error('Legacy SponsorBlock proxy found in IPK');
  }
  if (userScript.includes('__ytaf_debug__')) {
    throw new Error('Production debug instrumentation found in IPK');
  }

  const sha256 = createHash('sha256').update(archive).digest('hex');
  const manifest = JSON.parse(
    await readFile(`${appInfoSource.id}.manifest.json`, 'utf8')
  );
  if (manifest.ipkHash?.sha256 !== sha256) {
    throw new Error('Manifest SHA-256 does not match IPK');
  }
  console.info(`Verified ${ipkName} (${sha256})`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
