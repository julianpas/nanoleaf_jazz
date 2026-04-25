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

- Node.js 24
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

- `apps/web`: editor state, layout rendering, timeline UI, local project storage, import/export, device-effect library, and device power controls.
- `apps/bridge`: discovery, manual device registration, pairing, power control, layout fetch, preview, playback, device-effect import, and upload.
- `packages/shared`: project schema, layout hashing, migration/normalization, timing helpers, and color helpers.
- `apps/electron`: desktop shell around the built web UI and local bridge.
- `apps/browser-launcher`: starts the bridge and opens the built web UI in the default browser.

## Current Editing Model

The editor remains frame-based, but timing is now split into project defaults plus optional per-frame overrides.

- `AnimationProject.frameDurationMs` and `AnimationProject.transitionTimeMs` define the default timing.
- `AnimationFrame.frameDurationMs` and `AnimationFrame.transitionTimeMs` are optional overrides for the selected frame only.
- Shared helpers resolve effective timing for playback, preview, timeline labels, upload serialization, and imported device effects.

This matters when changing the project schema or Nanoleaf conversion logic: playback and upload should always use the resolved frame timing rather than assuming one global interval.

## Device Effects

The bridge can read existing effects from the Nanoleaf controller and expose them to the web app library.

- `requestAll` is used to list saved device effects.
- `request` is used to fetch one effect definition for import.
- Custom `animData` effects are converted into `AnimationProject` instances.
- Plugin or other non-frame-based effects are surfaced as library entries but marked unsupported for editing.

Imported custom effects preserve per-frame timing where the underlying Nanoleaf effect data can be mapped into the editor model.

## Persistence

Project data and recent paints are stored in IndexedDB inside the web app.

Device effects are not copied into IndexedDB automatically. Loading a device effect imports it into the live editor state, and saving it is still an explicit user action.

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
