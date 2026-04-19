# Nanoleaf Jazz

Local-first web app for designing frame-by-frame animations for Nanoleaf panel devices.

## Workspace

- `apps/web`: React editor UI
- `apps/bridge`: local Fastify bridge for device access on the LAN
- `packages/shared`: shared types and project helpers

## Development

```bash
npm install
npm run dev
```

The web app runs on `http://localhost:5173` and the bridge runs on `http://localhost:8787`.

## Release Targets

```bash
npm run release:browser
npm run release:electron
npm run release
```

- `release:browser` builds `release/browser-launcher/NanoleafJazz-Browser.exe`. This starts the local bridge and opens the default browser.
- `release:electron` builds a full Electron app in `release/electron`, including the Windows installer and zip package on Windows.
- `release` builds both targets.

## Current Scope

- Nanoleaf panel devices via local OpenAPI
- Frame-by-frame timeline editing
- Local project persistence in IndexedDB
- Live device preview and loop playback through the bridge
- Manual IP registration plus best-effort mDNS discovery
