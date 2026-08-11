# Threat model

## Trusted components

- The locally installed IPK and its bundled JavaScript.
- YouTube's HTTPS origin, which hosts the application UI and user session.
- SponsorBlock's HTTPS API only when explicitly enabled.

## Primary risks

- A compromised release could execute with the same YouTube session as the
  hosted application because the package replaces the official application ID.
- YouTube's private DOM and player APIs can change without notice.
- Legacy webOS TLS stores and browser engines have reduced compatibility.
- Unbounded external data or DOM observation can exhaust TV memory.

## Required controls

- Build from a clean commit and create the IPK only through `pnpm package`.
  Release mode refuses tracked or untracked source drift.
- Rebuild the package from source during verification and compare the source
  build, distribution tree, archive payload and release evidence byte for byte.
- Publish the linked SHA-256 index, complete CycloneDX SBOM, in-toto/SLSA
  provenance statement and third-party notices with every release.
- Sign the checksum index with an externally managed maintainer key and verify
  the signature after upload.
- Keep CORS disabled at package level and allow only explicit HTTPS endpoints.
- Reject oversized or malformed SponsorBlock data.
- Correlate third-party segment data with the current player video before any
  seek and cancel stale requests where the engine permits it.
- Reject unapproved source origins and dangerous runtime APIs during local QA.
- Protect the default branch and review dependency/security alerts.

## Residual limitations

- YouTube code and DOM contracts are remote, private and mutable.
- Older webOS fetch implementations buffer response bodies and lack
  `AbortController`; when CORS hides `Content-Length`, the client requires a
  JSON content type, rechecks the decoded UTF-8 size and ignores stale results,
  but cannot interrupt or reclaim an already buffered body.
- Hardware validation remains necessary; browser and ES5 tests do not emulate
  every webOS firmware.
- Local provenance and linked hashes establish consistency, not publisher
  identity. Without an externally verifiable checksum signature, an attacker
  able to replace every release asset can regenerate the entire evidence set.
