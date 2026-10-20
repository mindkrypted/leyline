# Installation

## macOS desktop release

Download the Apple silicon DMG and `SHA256SUMS` from the same
[GitHub Release](https://github.com/spmurrayzzz/leyline/releases). Open the
release's **Assets** section. The **Tags** page lists source archives only.
Intel Mac and Windows packages are not available.

The desktop app includes its backend and Node.js runtime. You do not need
Node.js, npm, or a Vite server to run the downloaded app.

### Verify the download

In Terminal, change to the folder that contains the DMG and `SHA256SUMS`.
Replace `/path/to/downloads` with that folder:

```bash
cd /path/to/downloads
shasum -a 256 --check --ignore-missing SHA256SUMS
```

Confirm that the DMG filename reports `OK`. The command skips the Linux
archive if you did not download it. If the DMG does not report `OK`, stop.
Download the matching files again before continuing.

### Install the app

If you are updating Leyline, finish or stop active runs first. Quit all
Leyline windows before replacing the app.

1. Open the DMG.
2. Drag `Leyline.app` to the **Applications** shortcut.
3. Eject the DMG.
4. Open `/Applications/Leyline.app`.

### macOS security warning

macOS builds use **ad-hoc signing**. They do not have an Apple Developer ID
signature or Apple notarization. Ad-hoc signing lets the build check the
bundle's integrity. It does not establish a trusted publisher or provide an
Apple malware scan.

On first launch, macOS can show **“Leyline” Not Opened** and say that Apple
could not verify the app is free of malware. Only approve a copy from the
official release page whose checksum matches.

1. Click **Done** or **Cancel** in the warning.
2. Open **System Settings → Privacy & Security**.
3. Scroll to **Security**.
4. Click **Open Anyway** for Leyline.
5. Authenticate when requested.
6. Confirm **Open**.

macOS can request approval again after an update or a new download. See
Apple's [instructions for opening an unnotarized app](https://support.apple.com/en-us/102445#openanyway).

### Quarantine fallback

If **Open Anyway** is unavailable or does not resolve the warning, check the
installed app's signature first:

```bash
codesign --verify --deep --strict --verbose=2 "/Applications/Leyline.app"
```

Continue only if the command succeeds. If it reports an invalid signature,
follow [the damaged-app checks](../reference/troubleshooting#macos-says-leyline-is-damaged).

For a verified release you trust, remove only Leyline's quarantine attribute:

```bash
xattr -dr com.apple.quarantine "/Applications/Leyline.app"
```

Then open Leyline again. This command bypasses quarantine checks for this copy
of Leyline. It does not notarize the app or disable Gatekeeper for other apps.
Do not disable Gatekeeper globally or remove quarantine from an entire folder
of downloaded apps.

Leyline does not remove quarantine automatically. Approval and the fallback
command require an explicit user action.

## Linux desktop app

For a user-local Linux desktop app, CLI launcher, and application-menu entry,
follow [Linux installation](./linux-installation).

## Build from source

The steps below set up the source checkout for browser or Electron development
on macOS or Linux.

Open the Leyline repository. Then install the dependencies:

```bash
npm install
```

A successful installation creates `node_modules/`. This repository does not
include a package lock.

npm fetches `@elune/embedded` from GitHub through the `spmurrayzzz/elune`
dependency. No npm publication or sibling Elune checkout is required. Leyline
includes trace storage and views, so no standalone Elune Go server or
`PI_TRACE_URL` is needed.

No separate backend process is necessary for browser development. Vite mounts
`server/pi-api/index.js` for `/api/pi/*` routes and the runtime, Git review, and terminal WebSockets.

Restart the backend after dependency updates. For a packaged app, rebuild,
install, and restart Electron. See [Packaging](../electron/packaging).

If installation fails, confirm that `node --version` returns `v22.19.0`. Then
see [Troubleshooting](../reference/troubleshooting#the-dev-server-does-not-start).
