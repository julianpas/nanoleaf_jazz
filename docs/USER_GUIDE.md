<p align="center">
  <img src="nanoleaf-jazz-icon.png" width="88" alt="Nanoleaf Jazz icon" />
</p>

# User Guide

Nanoleaf Jazz is a desktop-friendly editor for designing animations on Nanoleaf panel layouts. It works locally on your machine and talks to your Nanoleaf controller over your LAN.

![Nanoleaf Jazz editor screenshot](nanoleaf_jazz.png)

## Choose A Package

Download the latest build from [GitHub Releases](https://github.com/julianpas/nanoleaf_jazz/releases).

Recommended packages:

- Windows: `nanoleaf-jazz-electron-installer-windows.exe`
- macOS: `nanoleaf-jazz-electron-installer-macos.dmg`
- Ubuntu/Debian Linux: `nanoleaf-jazz-electron-installer-linux.deb`
- Portable Linux: `nanoleaf-jazz-electron-portable-linux.AppImage`

Alternative packages:

- `nanoleaf-jazz-electron-portable-windows.zip` runs the unpacked Electron app directly.
- `nanoleaf-jazz-electron-portable-macos.zip` runs the unpacked macOS app directly.
- `nanoleaf-jazz-browser-launcher-<platform>.zip` starts the local bridge and opens the app in your default browser.

Unsigned app note:

The builds are not code-signed yet. Windows SmartScreen or macOS Gatekeeper may warn on first launch.

## Install

### Windows

Run `nanoleaf-jazz-electron-installer-windows.exe` and follow the installer.

For the portable zip, extract it first, then run `Nanoleaf Jazz.exe` from the extracted folder.

### macOS

Open the `.dmg`, drag the app into Applications, and launch it.

If macOS blocks the unsigned app, open System Settings, Privacy & Security, and allow the app from there.

### Linux

For Debian/Ubuntu:

```bash
sudo apt install ./nanoleaf-jazz-electron-installer-linux.deb
```

For AppImage:

```bash
chmod +x nanoleaf-jazz-electron-portable-linux.AppImage
./nanoleaf-jazz-electron-portable-linux.AppImage
```

## Connect A Device

1. Make sure your computer and Nanoleaf controller are on the same local network.
2. Start Nanoleaf Jazz.
3. Use `Refresh` in the Devices section to discover devices automatically.
4. If discovery does not find your controller, enter the device IP address manually and click `Add`.
5. Put your Nanoleaf controller into pairing mode when the app asks for it (usually by pressing and holding the power button until it starts blinking).
6. After pairing, the device stays available through the locally stored bridge config.

Device pairing tokens are stored on your machine in your user profile under `.nanoleaf-jazz`.

## Editor Basics

The editor is built around a real panel layout, a toolbar, and a timeline.

Toolbar tools:

- `Paint`: apply the selected color and brightness to panels.
- `Erase`: clear panels back to black/off in the current frame.
- `Pick`: sample a panel color and brightness into the active paint and recent paints.
- `Select`: select panels without painting them.
- `Fill Selection`: apply the active paint to every selected panel.
- `Clear Frame`: clear the whole current frame.
- `Preview Frame`: send the current frame to the device once.
- `Play Loop`: loop the animation on the device until stopped.

Paint controls:

- Use the paint selector to choose color and brightness together.
- Recent paints remember color plus brightness.
- Recent paints are stored locally so they survive app restarts.

Timeline controls:

- `Add Frame`: append a new blank frame.
- `Duplicate`: copy the selected frame.
- `Move Left` and `Move Right`: reorder the selected frame.
- Frame tiles include mini-previews so you can navigate long animations quickly.

## Timing

Animation timing is controlled in the Project section:

- `Milliseconds Per Frame`: how long each frame is displayed.
- `Transition Time`: how smoothly one frame fades into the next.

Use `0 ms` transition time for hard cuts. Use a value below the frame duration for smoother fades.

## Orientation

Nanoleaf reports the relative panel positions, but your wall may be rotated differently from the app preview.

Use the Orientation controls to:

- Rotate the whole layout left or right.
- Flip the layout when the preview is mirrored.

These controls affect the editor preview mapping without changing the physical panel layout.

## Save, Export, Import, Upload

Project actions:

- `Save`: stores the current project locally in the app library.
- `Export`: downloads a project JSON file.
- `Import`: loads a previously exported project JSON file.
- `Upload`: creates a persistent custom effect on the connected Nanoleaf device.

The Library section lists locally saved projects. Use the trash icon to delete a saved project.

## Troubleshooting

If discovery fails:

- Enter the controller IP address manually.
- Confirm your computer and Nanoleaf controller are on the same network.
- Check whether your firewall allows local network traffic for the app.

If preview or upload fails:

- Reconnect the device from the Devices section.
- Confirm the controller still has the same IP address.
- Pair again if the Nanoleaf token was removed from the local config.

If the app layout looks mirrored or rotated:

- Use the Orientation controls until the preview matches the physical wall.
