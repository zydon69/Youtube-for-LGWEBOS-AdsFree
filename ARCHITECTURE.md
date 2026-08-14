# Architecture

## Runtime boundary

`src/userScript.ts` runs only in the top-level exact YouTube HTTPS origin. Its
isolated bootstrap loads infrastructure first, then explicitly calls each
feature installer. An installer is successful only after it has acquired its
listeners, hooks and owned DOM state; it returns a disposer through the
bootstrap. Shutdown occurs in reverse order on a non-bfcache `pagehide`.

Global JSON, fetch and YouTube `resolveCommand` hooks use immutable binding
generations. A host wrapper that captured an older generation therefore
delegates without recursively calling the newest hook. Feature transforms are
registered by name and must be bounded, shape-gated and reversible.

## Ownership rules

- A feature may change only DOM attributes/styles/classes it records and owns.
- Host changes made after acquisition win during restoration.
- Timers, observers, requests and listeners need an idempotent disposer.
- Network access is denied unless it passes the independent source sink policy
  in `tools/security-audit.js` and the runtime's exact-origin validation.
- SponsorBlock is opt-in and is disabled when the available fetch transport
  cannot enforce its redirect/referrer contract.

## Dependency direction

Feature modules depend on `core`, `hooks`, `player_api` and configuration.
Core modules never import the UI. Notifications are a small independent core
service, so UI evaluation cannot cascade into SponsorBlock or video quality.
Release tooling consumes built artifacts but runtime code never imports tools.

## Adding a feature

Provide an explicit `install()` and idempotent `dispose()`, isolate partial
installation failure, use the shared media/mutation services, register all
network sinks, add lifecycle and negative security tests, document privacy and
compatibility impact, and run `pnpm qa`.
