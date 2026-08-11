# Contributing

Use a focused branch and keep each change reviewable. Explain the webOS
versions and application features affected by behavior changes.

## Required checks

1. Install Node.js 24 independently and use the pnpm version pinned in
   `package.json`.
2. Install with `pnpm install --frozen-lockfile`.
3. Run `pnpm qa` before requesting review.
4. Add regression tests for fixes and update privacy, threat-model, vendor or
   release documentation when their contracts change.

Never commit credentials, device keys, account data, generated release
artifacts or third-party code without its license and provenance. Report
security vulnerabilities privately as described in `SECURITY.md`.

Maintainers alone create releases. A release must follow `RELEASING.md`; local
`package:dev` artifacts must not be published.
