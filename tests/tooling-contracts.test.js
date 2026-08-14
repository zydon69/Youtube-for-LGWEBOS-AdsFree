import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  APP_ID,
  APP_TITLE,
  artifactNames,
  assertAppInfo,
  assertReleaseState,
  assertSafeRelativePath,
  assertWebOSVersion,
  createManifest,
  formatChecksums,
  hashDirectory,
  listRelativeFiles,
  parseBuildMode
} from '../tools/package-contract.js';
import { runPinnedPnpm } from '../tools/pnpm-cli.js';
import { assertRuntimeNotices } from '../tools/gen-sbom.js';
import {
  inspectJavaScript,
  inspectNetworkText,
  inspectSecretText,
  isInspectableTextFile
} from '../tools/security-audit.js';

test('package paths, metadata and build modes fail closed', async () => {
  for (const path of ['', '../escape', '/absolute', 'a\\b', 'a//b']) {
    assert.throws(() => assertSafeRelativePath(path));
  }
  assert.throws(() => parseBuildMode(['--release']));
  assert.equal(parseBuildMode(['--dev']), 'development');
  const valid = JSON.parse(
    await readFile(new URL('../assets/appinfo.json', import.meta.url), 'utf8')
  );
  valid.version = '1.2.3';
  assert.equal(assertAppInfo(valid, '1.2.3'), valid);
  assert.throws(() =>
    assertAppInfo(
      {
        ...valid,
        vendorExtension: { ...valid.vendorExtension, allowCrossDomain: true }
      },
      '1.2.3'
    )
  );
  assert.throws(() =>
    assertAppInfo({ ...valid, privilegedJail: false }, '1.2.3')
  );
  assert.throws(() =>
    assertAppInfo({ ...valid, unexpectedCapability: true }, '1.2.3')
  );
  assert.throws(() =>
    assertAppInfo({ ...valid, icon: '../escape.png' }, '1.2.3')
  );
});

test('webOS versions reject prereleases, leading zeroes and oversized segments', () => {
  assert.equal(assertWebOSVersion('0.5.7'), '0.5.7');
  for (const invalid of [
    '0.5',
    '0.5.7-beta.1',
    '0.5.7+build',
    '01.2.3',
    '1.02.3',
    '1.2.000',
    '1234567890.2.3'
  ]) {
    assert.throws(() => assertWebOSVersion(invalid), /webOS version/);
    assert.throws(() => artifactNames(invalid), /webOS version/);
  }
});

test('release state rejects the wrong branch, remote, head, tag and index flags', () => {
  const valid = {
    branch: 'main',
    remoteURL: 'git@github.com:zydon69/Youtube-for-LGWEBOS-AdsFree.git',
    head: 'a'.repeat(40),
    remoteHead: 'a'.repeat(40),
    exactTag: 'v1.2.3',
    tagSignatureValid: true,
    flagged: []
  };
  assert.doesNotThrow(() => assertReleaseState(valid, '1.2.3'));
  for (const mutation of [
    { branch: 'feature' },
    { remoteURL: 'git@github.com:attacker/fork.git' },
    { remoteHead: 'b'.repeat(40) },
    { exactTag: 'v1.2.2' },
    { tagSignatureValid: false },
    { flagged: ['S src/userScript.ts'] }
  ]) {
    assert.throws(() => assertReleaseState({ ...valid, ...mutation }, '1.2.3'));
  }
});

test('directory contracts reject symlinks and hash canonical file contents', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ytaf-contract-'));
  try {
    await writeFile(join(directory, 'b.txt'), 'two');
    await writeFile(join(directory, 'a.txt'), 'one');
    const first = await hashDirectory(directory);
    assert.equal(first, await hashDirectory(directory, ['b.txt', 'a.txt']));
    await symlink(join(directory, 'a.txt'), join(directory, 'link.txt'));
    await assert.rejects(listRelativeFiles(directory), /Unsupported/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('artifact evidence binds exact hashes and has deterministic ordering', () => {
  const names = artifactNames('1.2.3');
  const manifest = createManifest(
    {
      id: APP_ID,
      version: '1.2.3',
      type: 'web',
      title: APP_TITLE
    },
    names,
    {
      mode: 'development',
      dirty: true,
      commit: 'a'.repeat(40),
      gitTree: 'b'.repeat(40),
      sourceTreeSha256: 'c'.repeat(64)
    },
    { ipk: 'd'.repeat(64), sbom: 'e'.repeat(64), distTree: 'f'.repeat(64) }
  );
  assert.equal(manifest.ipkHash.sha256, 'd'.repeat(64));
  assert.equal(formatChecksums({ z: '2', a: '1' }), '1  a\n2  z\n');
});

test('runtime SBOM components require explicit copyright notices', () => {
  const component = { name: 'whatwg-fetch', scope: 'required' };
  assert.doesNotThrow(() =>
    assertRuntimeNotices([component], 'whatwg-fetch copyright GitHub, Inc.')
  );
  assert.throws(
    () => assertRuntimeNotices([component], 'generic MIT dependency'),
    /incomplete/
  );
  assert.throws(
    () =>
      assertRuntimeNotices(
        [{ name: 'unreviewed-runtime', scope: 'required' }],
        'unreviewed-runtime'
      ),
    /incomplete/
  );
});

test('security policy rejects clear-text, foreign and dynamic egress surfaces', async () => {
  const failures = [];
  const origins = new Set();
  inspectNetworkText('fixture', 'http://evil.example/x', failures, origins);
  inspectNetworkText('fixture', '//evil.example/x', failures, origins);
  assert.equal(failures.length, 2);

  const directory = await mkdtemp(join(tmpdir(), 'ytaf-security-'));
  const source = join(directory, 'hostile.js');
  try {
    await writeFile(
      source,
      "fetch('https://evil.example/data'); new WebSocket('wss://evil.example')"
    );
    const sourceFailures = [];
    await inspectJavaScript(source, true, sourceFailures, new Set());
    assert.ok(
      sourceFailures.some((failure) =>
        /unapproved runtime origin/.test(failure)
      )
    );
    assert.ok(
      sourceFailures.some((failure) =>
        /forbidden runtime API WebSocket/.test(failure)
      )
    );
    await writeFile(
      source,
      'export function leak(target) { return fetch(target); }'
    );
    const dynamicFailures = [];
    await inspectJavaScript(source, true, dynamicFailures, new Set());
    assert.ok(
      dynamicFailures.some((failure) =>
        /egress sink contract changed/.test(failure)
      )
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('secret policy covers sensitive dotfiles, key material and modern tokens', () => {
  for (const name of [
    '.env',
    '.env.production',
    '.netrc',
    '.npmrc',
    'secret.key',
    'secret.pem'
  ]) {
    assert.equal(isInspectableTextFile(name), true);
  }
  const fixtures = [
    '-----BEGIN ' + 'OPENSSH PRIVATE KEY-----',
    'ASIA' + 'A'.repeat(16),
    'github' + '_pat_' + 'a'.repeat(70),
    'npm_' + 'a'.repeat(36),
    'xoxb-' + 'a'.repeat(20),
    'sk_' + 'live_' + 'a'.repeat(24),
    'eyJ' + 'a'.repeat(12) + '.' + 'b'.repeat(12) + '.' + 'c'.repeat(12)
  ];
  const failures = [];
  fixtures.forEach((fixture, index) => {
    inspectSecretText(`fixture-${index}`, fixture, failures);
  });
  assert.equal(failures.length, fixtures.length);
});

test('tooling invokes the pinned pnpm independently of PATH order', () => {
  if (!process.env.npm_execpath) {
    assert.throws(
      () => runPinnedPnpm(['--version'], { encoding: 'utf8' }),
      /unavailable/
    );
    return;
  }
  const previousPath = process.env.PATH;
  process.env.PATH = `/definitely-not-pnpm:${previousPath}`;
  try {
    assert.equal(
      runPinnedPnpm(['--version'], { encoding: 'utf8' }).trim(),
      '10.33.0'
    );
  } finally {
    process.env.PATH = previousPath;
  }
});
