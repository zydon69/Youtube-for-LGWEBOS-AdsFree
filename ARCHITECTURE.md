# Architecture

## Runtime boundary

`src/userScript.ts` runs only in the top-level exact YouTube HTTPS origin. Its
isolated bootstrap loads infrastructure first, then explicitly calls each
feature installer. An installer is successful only after it has acquired its
listeners, hooks and owned DOM state; it returns a disposer through the
bootstrap. Waiting for a player is deferred and never delays unrelated
installers. The command registry can be installed before any host target exists;
it synchronizes targets through one registry without a second waiting path.
Shutdown occurs in reverse order on a non-bfcache `pagehide`.

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

## Media and operations

The active-media resolver is the only media selection authority. An explicit
player root is a strict boundary: an empty root never borrows another video's
media. Screen-hidden presentation is tracked explicitly and cannot override a
host-hidden or disconnected player. SponsorBlock correlates the player, media,
source and confirmed video ID before each seek, and shares one end tolerance
between scheduling and confirmation.

Player getters have no synchronization side effects. Callers explicitly refresh
the manager, then read a coherent player/video snapshot. Quality operations own
their timers individually; synchronous host events and callbacks delivered after
cancellation cannot clean up or confirm another operation. Each video receives
an explicit range write, even if its observed quality already equals its maximum.

## Settings navigation and persistence

Settings focus moves locally within the dialog using current focus and geometry.
The application installs no global spatial-navigation API, DOM prototype methods
or DOMRect replacement. One DOM matching adapter handles browser differences.
Configuration migration and PREF cookie scope migration normalize persisted data
at their boundaries; there are no competing feature implementations for old data.
Automatic account selection consumes only the first valid startup command in a
document session, preserving later manual account selection.

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
