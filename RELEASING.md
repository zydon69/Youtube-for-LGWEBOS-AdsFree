# Release procedure

1. Provision Node.js 24 and pnpm 10.33.0 independently. The repository must
   never download or install its own Node.js runtime.
2. Start from a clean, reviewed commit on `main`, fetch the intended remote,
   and verify that `git status --short` is empty.
3. Run `pnpm install --frozen-lockfile`.
4. Create and verify the signed `v<version>` tag on that commit, then push the
   commit and tag. Release tooling checks the live `origin/main`, repository
   URL, exact tag and signature and rejects hidden Git index flags.
5. Run `pnpm package`. It runs the complete QA gate, creates the SBOM and
   package, and independently rebuilds and verifies every release artifact.
6. Inspect the QA output and SBOM, then install the verified IPK on every
   supported webOS engine family.
7. Sign the generated `youtube.leanback.v4_<version>_all.sha256` file with an
   externally managed maintainer key.
8. Publish the IPK, `youtube.leanback.v4.manifest.json`, `sbom.cdx.json`,
   provenance statement, checksum index, checksum signature and
   `THIRD_PARTY_NOTICES.md` together. Verify the uploaded bytes again.

Never publish an IPK copied from an older `dist` directory. A release is
blocked if a high-severity scanner, source policy, compatibility test or device
test fails. The local policy is a deterministic baseline, not a substitute for
reviewing release diffs or running independent SAST and secret scanners.

The generated in-toto/SLSA statement is an unsigned local attestation. Its
subjects and the checksum index cryptographically bind the IPK, manifest and
SBOM to one another and to the recorded source tree, but they do not prove the
publisher's identity. Authenticating the publisher requires the external key
in step 7 (for example GPG, SSH signing, Sigstore/cosign, or an equivalent
organization-managed service). The private key must never be stored in this
repository.

`pnpm package:dev` and `pnpm verify:package:dev` are only for local validation
of an intentionally dirty worktree. Their metadata records `development` and
`dirty: true`; these artifacts are not release candidates.
