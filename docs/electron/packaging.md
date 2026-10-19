---
description: Build and install the Leyline desktop app for macOS or Linux, including native terminal files and embedded tracing.
---

# Packaging

## Download a release

Published [GitHub Releases](https://github.com/spmurrayzzz/leyline/releases)
include an Apple silicon macOS DMG, a Linux x64 archive, and `SHA256SUMS`.
Expand **Assets** on the release page to find the downloads. The **Tags** page
lists source archives only.

For macOS installation, checksum verification, and first-launch security
approval, follow [Installation](../getting-started/installation#macos-desktop-release).

## Build the desktop app

Run:

```bash
npm run electron:build
```

The script runs `npm run build` first. This creates the app in `dist/` and the
VitePress site in `dist/docs/`. Electron Packager then writes the desktop
package to `release/` for the host platform and architecture. The x86-64 Linux
output is `release/Leyline-linux-x64/`.

The package uses icon files under `assets/icon`. The build unpacks native
`node-pty` files and `spawn-helper`. The packaged terminal can fail with
`ENOTDIR` if these files stay inside the Electron archive.

The build also places `@elune/embedded`, including its SQLite worker, in
`app.asar.unpacked`. The native backend runs in an Electron utility process.
The package needs no sibling Elune checkout or standalone Go server. See
[Elune integration](../integrations/elune).

On macOS, Electron Packager ad-hoc signs the completed bundle, including its
helpers and frameworks. Signing failures stop the build. The release workflow
also runs strict, recursive `codesign` verification before creating the DMG.
DMG integrity checks alone do not validate the app's signature.

Ad-hoc signing requires no Apple credentials. It does not provide Developer ID
signing or Apple notarization. Users can still see a macOS security warning and
need [manual approval](../getting-started/installation#macos-security-warning).
The build does not remove quarantine or disable Gatekeeper.

After dependency or backend updates, rebuild, install, and restart the app.
A browser refresh cannot update files in an installed Electron package.

The packaging flow uses these files:

- `scripts/electron-build.sh`
- `electron/main.js`
- `electron/leyline-server-process.js`
- `server/leyline-server.js`
- `server/pi-api/`

## Version tags and GitHub releases

From a clean tracked working tree, run one local version command:

```bash
npm run version:patch
npm run version:minor
npm run version:major
```

Each command updates `package.json`, creates a release commit, and adds an
annotated `v` version tag. It creates no package lock and does not push or
publish anything.

After you push the commit and tag, `.github/workflows/release.yml` builds both
platforms and creates a **draft GitHub Release** with the packages and
checksums. Publishing the draft is a separate manual action. Only users with
repository write access can see the draft and download its assets.

A manual **Actions → Build releases → Run workflow** run uploads workflow
artifacts only. It does not create a release or a version tag. Download those
artifacts from the completed workflow run's summary page.

## Install on Linux

Follow [Linux installation](../getting-started/linux-installation) to copy the
complete package to `~/.local/opt/leyline`, create a Linux CLI launcher, and add
an application-menu entry. That guide also covers verification and updates.

Do not use `npm run local-publish` or the repository's `bin/leyline` on Linux;
both currently assume a macOS app bundle.

## Install on Apple silicon macOS

For a downloaded DMG, follow [Installation](../getting-started/installation#macos-desktop-release).
To build and install from your source checkout, run:

```bash
npm run local-publish
```

This command builds the app and copies it to `/Applications/Leyline.app`. It
also links `bin/leyline` at `~/.local/bin/leyline`.

The local publish script expects `release/Leyline-darwin-arm64/Leyline.app`.
Thus, the current local publication flow supports Apple silicon macOS builds.
