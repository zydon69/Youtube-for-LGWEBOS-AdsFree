# Accepted risks

## Official application identifier

- Owner: `zydon69`.
- Reason: DIAL integration and replacement of the stock YouTube application
  require `youtube.leanback.v4`.
- Horizon: permanent while this compatibility is required.
- Controls: exact YouTube HTTPS origin, CORS disabled, deterministic IPK,
  published checksum and protected release procedure.
- Exit criterion: LG provides a supported identifier and DIAL integration for
  third-party applications.

## Source GitHub Actions disabled

- Owner: `zydon69`.
- Reason: explicit manual-release policy.
- Horizon: review before accepting external release maintainers.
- Controls: local `pnpm qa`, clean-tree release refusal, deterministic
  packaging, a fresh source rebuild during package verification, linked SBOM
  and provenance evidence, and a manually verified checksum signature.
- Exit criterion: a reviewed CI design with immutable third-party action SHAs
  and no release credentials exposed to untrusted pull requests.

## Generated dynamic global detection

- Owner: dependency maintenance (`zydon69`).
- Reason: Babel/core-js compatibility helpers contain fallback `Function`
  expressions for global/Node detection. They are dependency code, not called
  in the webOS browser path where `window` is available.
- Horizon: review at every Babel/core-js upgrade.
- Controls: no dynamic execution in application sources, lockfile integrity,
  SBOM and dependency scanning.
- Exit criterion: removal of legacy browser targets or upstream helpers that no
  longer use dynamic fallback expressions.

## Hardware compatibility matrix

- Owner: `zydon69`.
- Reason: automated access to every webOS generation is unavailable.
- Horizon: blocks claims of universal webOS compatibility.
- Controls: ES5 bundle check and explicit legacy-compatible event dispatcher.
- Exit criterion: successful installation, launch, YouTube playback, settings,
  SponsorBlock opt-in and navigation tests on each claimed engine family.

## YouTube private integration hooks

- Owner: `zydon69`.
- Reason: ad filtering, account selection and language fixes require adapting
  undocumented YouTube TV payloads. JSON and fetch hooks are installed at the
  application edge because YouTube exposes no supported extension API.
- Horizon: review whenever YouTube changes its application schema.
- Controls: exact-shape guards, transactional JSON transformations, duplicate
  hook rejection, reversible fetch hook and rebindable command registry.
- Exit criterion: YouTube publishes a supported interception/extension API or
  the affected features are removed.

## Legacy buffered fetch

- Owner: SponsorBlock integration (`zydon69`).
- Reason: older supported webOS engines expose a buffered fetch polyfill with
  neither response streams nor `AbortController`.
- Horizon: review whenever the minimum supported webOS version changes.
- Controls: opt-in only, official HTTPS endpoint, JSON `Content-Type` required
  when CORS does not expose `Content-Length`, decoded UTF-8 size recheck after
  the unavoidable legacy buffer, a logical timeout covering fetch and body
  decoding, schema bounds and stale-result discard. On engines without
  `AbortController`, the rejected request's underlying network buffer may still
  continue until the browser finishes it.
- Exit criterion: all supported engines provide streaming fetch and abortable
  requests, or the integration moves to a transport with progress cancellation.

## webOS compatibility User-Agent

- Owner: `zydon69`.
- Reason: the stock-compatible User-Agent exposes the TV model, firmware,
  platform and network mode so YouTube can select the expected TV client and
  compatibility behavior.
- Horizon: review whenever the minimum supported webOS version or YouTube
  client contract changes.
- Controls: the value is declarative and sent through browser HTTPS requests;
  it reaches YouTube and, only after SponsorBlock opt-in, SponsorBlock. The
  disclosure is documented in `PRIVACY.md`.
- Exit criterion: a reduced User-Agent has been tested successfully across the
  supported physical-TV matrix and no longer needs model, firmware or network
  mode placeholders.

## Local unsigned provenance

- Owner: release maintainers (`zydon69`).
- Reason: local development has no centrally managed signing identity or
  hardware-backed key available to the packaging tool.
- Horizon: review before every public release and whenever release ownership
  changes.
- Controls: deterministic source rebuild, exact artifact comparison, an
  in-toto/SLSA statement, a checksum index binding every output, a signed Git
  tag, and an external signature over the checksum index before publication.
- Exit criterion: an organization-managed signing or transparency service can
  issue and verify release attestations without exposing credentials to the
  repository or untrusted contributions.

## JavaScript test type coverage

- Owner: `zydon69`.
- Reason: several test doubles intentionally implement only small DOM and
  happy-dom surfaces; their structural shapes are not assignable to the full
  `lib.dom` interfaces required by project-wide `checkJs`.
- Horizon: reduce progressively while migrating test helpers and suites to
  TypeScript.
- Controls: ESLint with zero warnings, execution under the pinned Node.js
  runtime, behavioral assertions and whole-runtime coverage thresholds.
- Exit criterion: the complete test suite and its DOM fakes are type-checked
  without broad suppressions or weakening production compiler settings.
