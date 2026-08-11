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
- Controls: local `pnpm qa`, deterministic packaging and package verifier.
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
