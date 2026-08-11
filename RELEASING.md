# Release procedure

1. Start from a clean, reviewed commit on `main`.
2. Run `pnpm install --frozen-lockfile`.
3. Run `pnpm qa`.
4. Run `pnpm package`.
5. Run `pnpm verify:package`.
6. Install the generated IPK on every supported webOS engine family.
7. Sign the Git tag and publish the IPK, manifest, `sbom.cdx.json`, checksum
   and `THIRD_PARTY_NOTICES.md` together.

Never publish an IPK copied from an older `dist` directory. A release is
blocked if a high-severity scanner, compatibility test or device test fails.
