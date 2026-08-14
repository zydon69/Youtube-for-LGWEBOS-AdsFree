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

## Stock-compatible application privileges

- Owner: `zydon69`.
- Reason: `trustLevel: netcast` and `privilegedJail` reproduce the stock
  application's webOS execution profile required by DIAL, input registration
  and replacement installation. The JavaScript does not call Luna services or
  expose a general native bridge.
- Horizon: review on every manifest or minimum-webOS change.
- Controls: exact manifest contract in packaging, top-frame/exact-origin
  runtime guard, CORS enforcement, egress sink inventory and no dynamic code
  execution in first-party sources.
- Exit criterion: physical-device tests prove the same integrations work with
  a less privileged documented webOS profile.

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
- Reason: older webOS engines expose a buffered fetch polyfill that cannot
  enforce the no-redirect and no-referrer policy required by SponsorBlock.
- Horizon: review whenever the minimum supported webOS version changes.
- Controls: SponsorBlock now fails closed on transports that do not retain
  `redirect: error` and `referrerPolicy: no-referrer`. Native transports also
  revalidate the final response URL, bound response bytes and retries, and
  discard stale results. Ad blocking and all local features remain available.
- Exit criterion: a legacy transport can cryptographically and technically
  enforce the same redirect/referrer policy as native fetch.

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

## Local non-hermetic builder

- Owner: release maintainers (`zydon69`).
- Reason: GitHub Actions are intentionally disabled and the project does not
  currently provide an organization-managed immutable build image or an
  independent second builder.
- Horizon: must be reviewed before every public release; target milestone is
  the first signed public release.
- Controls: pinned Node/pnpm versions, frozen lockfile integrity, exact vendored
  hashes, clean reviewed Git state, QA receipt bound to source/lock/dist,
  deterministic rebuild, SBOM, provenance and externally signed checksums.
- Exit criterion: two isolated builders starting from the signed tag and empty
  package stores produce byte-identical IPKs and independently signed
  attestations.

## Solo-maintainer GitHub review policy

- Owner: repository administrator (`zydon69`).
- Reason: the repository currently has no second maintainer available to
  provide a mandatory CODEOWNER approval while GitHub Actions remain disabled.
- Horizon: review before accepting any external contribution or publishing the
  first signed release.
- Controls: protected `main`, no force-push or deletion, linear history,
  conversation resolution, local zero-warning QA and signed release tag.
- Exit criterion: configure at least one independent required CODEOWNER
  approval, approval of the latest push and verified commit/tag signatures.

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
