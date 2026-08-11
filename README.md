<h1 align="center">
  YouTube Ad-Free
</h1>
<p align="center">
  <img src="https://img.shields.io/github/stars/zydon69/Youtube-for-LGWEBOS-AdsFree?style=flat-square&logo=github" alt="GitHub Stars">
  <img src="https://img.shields.io/github/contributors/zydon69/Youtube-for-LGWEBOS-AdsFree?style=flat-square" alt="Contributors">
  <img src="https://img.shields.io/github/downloads/zydon69/Youtube-for-LGWEBOS-AdsFree/total?style=flat-square" alt="Total Downloads">
  <img src="https://img.shields.io/badge/LG-webOS-000000?logo=webos&logoColor=white&style=flat-square" alt="webOS">
</p>

<p align="center">
  YouTube app for webOS TV with ad blocking and other enhancements
</p>

> [!NOTE]
> This repository is an independently maintained fork of
> [webosbrew/youtube-webos](https://github.com/webosbrew/youtube-webos).
> GitHub Actions are intentionally disabled; releases must be built and
> published manually after running the local QA command.

![Configuration Screen](./screenshots/1_sm.jpg?raw=true)
![Segment Skipped](./screenshots/2_sm.jpg?raw=true)

---

## Features

- Ad Blocking
- Optional [SponsorBlock](https://sponsor.ajay.app/) integration (disabled by default)
- [Autostart Support](#autostart)
- Force Highest Video Quality
- Screen-hidden mode (🟦 Blue button on remote; playback continues normally)
- Full Animation Support
- Shorts Removal
- Higher-Quality Thumbnails
- On-Screen Clock Overlay
- YouTube Logo Removal
- Remove end screens
- Bypass account selector screen

> [!NOTE]
> Press the 🟩 **Green** button on your remote to access the configuration screen.

---

## Requirements

- Uninstall the official YouTube app before installing this one.

---

## Installation

Until this fork publishes a signed GitHub release, build the IPK locally from a
reviewed commit using the instructions below. The official webOS Brew package
currently points to the upstream project and does not install this fork.

The generated IPK can be installed with
[Device Manager](https://github.com/webosbrew/dev-manager-desktop) or the webOS
CLI.

---

## Autostart

To enable autostart, run the following command needs to be executed on the TV via **SSH** or **Telnet**:

```sh
luna-send-pub -n 1 'luna://com.webos.service.eim/addDevice' '{"appId":"youtube.leanback.v4","pigImage":"","mvpdIcon":""}'
```

This allows the app to show up as an input source and launch automatically if it was the last used app. It will remain active in the background for faster startup (minor increase in idle memory usage).

To disable autostart:

```sh
luna-send-pub -n 1 'luna://com.webos.service.eim/deleteDevice' '{"appId":"youtube.leanback.v4"}'
```

---

## Development Setup

### Pre-requisites

- **Node.js 24 LTS**, installed independently before cloning or installing
  dependencies. This repository never downloads a Node.js runtime.
- **pnpm 10.33.0**. The exact package-manager release and integrity hash are
  pinned in [`package.json`](package.json); `corepack enable` can expose it.
- **git**
- A trusted webOS CLI available on `PATH` is required only for device setup,
  deployment, launch, and inspection. Building and packaging do not depend on it.

### Setup

1. Clone the repository.

   ```sh
   git clone https://github.com/zydon69/Youtube-for-LGWEBOS-AdsFree.git
   cd Youtube-for-LGWEBOS-AdsFree
   ```

2. Install dependencies.

   ```sh
   pnpm install --frozen-lockfile
   ```

### Building an IPK

```sh
pnpm run package
```

The packaging command first runs linting, strict type checking, source security
policy checks, coverage-gated unit tests, the production build, bundle and
Playwright browser tests, ES5 compatibility validation and the dependency
audit. Packaging stops on any failure.

Coverage is collected with `--all` across every first-party JavaScript and
TypeScript runtime file. Only the two separately hashed and regression-tested
vendored polyfills are excluded; the enforced floors are 70% statements/lines,
70% branches and 85% functions. These are baseline regression guards, not a
claim that the remaining integration-heavy runtime is fully tested.

Release packaging accepts only a clean Git worktree. It produces a linked set
of five artifacts: the IPK, the repository manifest, a complete CycloneDX SBOM,
an in-toto/SLSA provenance statement, and a SHA-256 index. `pnpm package:dev`
is available for local testing from a dirty worktree; its evidence is explicitly
marked `development`/`dirty` and must never be published as a release.

SponsorBlock sends a short hashed video-ID prefix to its external API only when
the user enables it. See [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md)
and [THREAT_MODEL.md](THREAT_MODEL.md) before distributing the application.

The `.ipk` file will be generated in the project root directory. You can stop here if you're fine with installing the IPK via [the webOS Dev Manager app](https://github.com/webosbrew/dev-manager-desktop). Alternatively, continue below if you want to make it so you can install the IPK on your TV with one command.

### On the TV

> [!IMPORTANT]
> If your TV is rooted, follow [the alternative setup section](#alternate-setup-rooted-tv) instead and then skip to [installing to the TV](#installing-to-the-tv)

1. Create an [LG Developer account](https://webostv.developer.lge.com/login)
2. Install the [**Developer Mode** app](https://in.lgappstv.com/main/tvapp/detail?appId=232503) from the LG Content Store
3. Navigate to the app, Log-in in with LG Developer Credentials and enable:
   - Developer Mode
   - Key Server

### Add the TV to the CLI

```sh
ares-setup-device
```

Follow the prompts:

1. Add device
2. Enter IP from the Developer Mode app
3. Use default values unless needed
4. Enter 6-digit passphrase shown on the TV screen

Verify:

```sh
ares-setup-device --list
```

Sample output:

```log
name            deviceinfo                     connection  profile    passphrase
--------------  -----------------------------  ----------  -------    ----------
mytv (default)  prisoner@192.168.137.102:9922  ssh         tv         EF32E8
```

---

## Installing to the TV

```sh
pnpm run deploy # Installs to the default device selected via `ares-setup-device`.
```

## Debugging

webOS supports the standard Chrome Devtools Protocol which allows you to inspect the app.

```sh
ares-inspect -d <device_name> --app youtube.leanback.v4
```

Or if you've set your TV as the default device:

```sh
pnpm run inspect
```

---

## Alternate Setup (Rooted TV)

1. Enable SSH via Homebrew Channel
2. Generate SSH key:

   ```sh
   ssh-keygen -t rsa
   ```

3. Copy `id_rsa` to `~/.ssh` (Windows: `%USERPROFILE%\.ssh`)
4. Append `id_rsa.pub` to `/home/root/.ssh/authorized_keys` on the TV
5. Set up device:

   ```sh
   ares-setup-device -a webos \
     -i "username=root" \
     -i "privatekey=id_rsa" \
     -i "passphrase=SSH_KEY_PASSPHRASE" \
     -i "host=TV_IP" \
     -i "port=22"
   ```

---

## Quick Commands

### Build, Install, and Launch

```sh
pnpm run package && pnpm run deploy && pnpm run launch
```

For an explicitly non-release build from a dirty worktree, use
`pnpm run package:dev` followed by `pnpm run deploy:dev`.

To launch a specific video directly:

```sh
pnpm run launch -- -p '{"contentTarget":"v=F8PGWLvn1mQ"}'
```
