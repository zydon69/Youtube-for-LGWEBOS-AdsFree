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

- Build from a clean commit, run `pnpm qa`, and create the IPK only through
  `pnpm package`.
- Publish SHA-256, SBOM and third-party notices with every release.
- Keep CORS disabled at package level and allow only explicit HTTPS endpoints.
- Reject oversized or malformed SponsorBlock data.
- Protect the default branch and review dependency/security alerts.
