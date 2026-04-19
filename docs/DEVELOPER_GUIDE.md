<p align="center">
  <img src="nanoleaf-jazz-icon.png" width="88" alt="Nanoleaf Jazz icon" />
</p>

# Developer Guide

This guide covers running Nanoleaf Jazz from source, building packages, and understanding how the pieces fit together.

## Repository Layout

```text
apps/
  web/               React/Vite editor UI
  bridge/            Fastify LAN bridge for Nanoleaf API access
  browser-launcher/  Small native launcher that starts the bridge and opens a browser
  electron/          Electron desktop shell
packages/
  shared/            Shared TypeScript types, normalization, color helpers
scripts/
  collect-release-assets.ps1
  generate-app-icons.ps1
  release-browser-launcher.mjs
docs/
  USER_GUIDE.md
  DEVELOPER_GUIDE.md
```

## Prerequisites

- Node.js 22
- npm
- A Nanoleaf panel device on the same LAN for real device testing

Windows PowerShell is used by the release helper scripts. GitHub Actions runs those scripts with `pwsh`.

## Run Locally

Install dependencies:

```bash
npm install
```

Start the bridge and web UI:

```bash
npm run dev
```

Development endpoints:

- Web UI: `http://localhost:5173`
- Bridge API: `http://localhost:8787`

The Vite dev server proxies `/api` to the bridge, so the browser can call the local bridge without direct LAN API access.

## Validate

```bash
npm run typecheck
npm run build
```

`typecheck` validates the shared package, bridge, and web app. `build` emits the shared package, bridge, and Vite production build.

## Build Release Packages

Browser launcher:

```bash
npm run release:browser
```

Electron app:

```bash
npm run release:electron
```

Both:

```bash
npm run release
```

Release output is written under `release/`.

## Release Assets

GitHub Actions builds on Windows, macOS, and Linux. The workflow collects explicit assets instead of zipping the entire release folder.

Expected release assets:

- `nanoleaf-jazz-browser-launcher-windows.zip`
- `nanoleaf-jazz-electron-installer-windows.exe`
- `nanoleaf-jazz-electron-portable-windows.zip`
- `nanoleaf-jazz-browser-launcher-macos.zip`
- `nanoleaf-jazz-electron-installer-macos.dmg`
- `nanoleaf-jazz-electron-portable-macos.zip`
- `nanoleaf-jazz-browser-launcher-linux.zip`
- `nanoleaf-jazz-electron-installer-linux.deb`
- `nanoleaf-jazz-electron-portable-linux.AppImage`

The release workflow runs on tags matching `v*` and can also be started manually.

## Architecture

Nanoleaf Jazz uses a local bridge because browsers cannot reliably discover LAN devices or call all local controller endpoints directly.

Flow:

```text
React UI -> /api -> local Fastify bridge -> Nanoleaf controller on LAN
```

Main responsibilities:

- `apps/web`: editor state, layout rendering, timeline UI, local project storage, import/export.
- `apps/bridge`: discovery, manual device registration, pairing, layout fetch, preview, playback, upload.
- `packages/shared`: project schema, layout hashing, migration/normalization, color helpers.
- `apps/electron`: desktop shell around the built web UI and local bridge.
- `apps/browser-launcher`: starts the bridge and opens the built web UI in the default browser.

## Persistence

Project data and recent paints are stored in IndexedDB inside the web app.

Device pairing/config data is stored by the bridge under the current user's `.nanoleaf-jazz` config folder. This keeps API tokens local to the machine and outside exported project files.

## Icons

The app icon source is stored at:

```text
apps/electron/build/icon.png
```

Derived packaging icons are stored in:

```text
apps/electron/build/icon.ico
apps/electron/build/icon.icns
apps/electron/build/icons/
apps/browser-launcher/build/
```

Regenerate derived icons after replacing the source PNG:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-app-icons.ps1
```
