import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { generateSbom } from '../tools/gen-sbom.js';
import { createPackage } from '../tools/package.js';
import { sha256 } from '../tools/package-contract.js';
import { verifyPackage } from '../tools/verify-package.js';

test(
  'development packaging binds QA, SBOM, provenance and checksums',
  {
    skip: process.env.npm_lifecycle_event !== 'test:package-integration'
  },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytaf-package-test-'));
    const sbomPath = join(directory, 'sbom.cdx.json');
    try {
      await generateSbom({
        mode: 'development',
        outputPath: sbomPath,
        quiet: true
      });
      const result = await createPackage({
        mode: 'development',
        outputDirectory: directory,
        sbomPath,
        quiet: true
      });
      const names = result.names;
      const [ipk, manifestBytes, provenanceBytes, checksums] =
        await Promise.all([
          readFile(join(directory, names.ipk)),
          readFile(join(directory, names.manifest)),
          readFile(join(directory, names.provenance)),
          readFile(join(directory, names.checksums), 'utf8')
        ]);
      const manifest = JSON.parse(manifestBytes.toString('utf8'));
      const provenance = JSON.parse(provenanceBytes.toString('utf8'));
      assert.equal(manifest.ipkHash.sha256, sha256(ipk));
      assert.equal(manifest.releaseEvidence.mode, 'development');
      assert.deepEqual(
        manifest.releaseEvidence.qa,
        provenance.predicate.runDetails.metadata.qa
      );
      assert.match(checksums, new RegExp(`${result.ipkSha256}  ${names.ipk}`));
      assert.match(
        checksums,
        new RegExp(`${sha256(provenanceBytes)}  ${names.provenance}`)
      );
      await verifyPackage({
        mode: 'development',
        artifactDirectory: directory
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);
