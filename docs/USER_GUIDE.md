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

Once a device is paired and reachable, the compact device header shows a power button you can use to turn the current controller on or off without leaving the app.

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
- Frame tiles include mini-previews and show the effective frame duration so you can navigate long animations quickly.

## Timing

Animation timing is controlled in the Project section:

- `Milliseconds Per Frame`: the default duration used by frames that do not override it.
- `Transition Time`: the default fade time used by frames that do not override it.
- `Current Frame`: each timing row includes a per-frame override field beside the default.
- `Reset`: the small reset icon clears the current frame override and falls back to the project default again.

Use `0 ms` transition time for hard cuts. Use a value below the frame duration for smoother fades.

If you leave a current-frame timing field empty, that frame uses the default project timing. This makes it easy to keep most frames consistent and only adjust the few that need longer holds or faster transitions.

## Orientation

Nanoleaf reports the relative panel positions, but your wall may be rotated differently from the app preview.

Use the Orientation controls to:

- Rotate the whole layout left or right.
- Flip the layout when the preview is mirrored.

These controls affect the editor preview mapping without changing the physical panel layout.

## Save, Import From Device, Export, Upload

Project actions:

- `Save`: stores the current project locally in the app library.
- `Export`: downloads a project JSON file.
- `Import`: loads a previously exported project JSON file.
- `Upload`: creates a persistent custom effect on the connected Nanoleaf device.

The Library section has two sources:

- `Local Projects`: projects saved in the app. Use the trash icon to delete a saved project.
- `Device Effects`: effects already stored on the paired Nanoleaf controller.

Device effect notes:

- Supported custom effects can be loaded into the editor and edited like normal Jazz projects.
- The currently active device effect is marked in the library.
- Some Nanoleaf effects are listed but not editable. This usually applies to plugin or motion-based effects that do not map cleanly to the frame-by-frame editor.
- Use `Refresh` in the Library section if you uploaded an effect from another app or changed effects on the controller outside Nanoleaf Jazz.

## Troubleshooting

If discovery fails:

- Enter the controller IP address manually.
- Confirm your computer and Nanoleaf controller are on the same network.
- Check whether your firewall allows local network traffic for the app.

If preview or upload fails:

- Reconnect the device from the Devices section.
- Confirm the controller still has the same IP address.
- Pair again if the Nanoleaf token was removed from the local config.

If a device effect appears but cannot be loaded into the editor:

- The effect may be a Nanoleaf plugin effect rather than a custom frame animation.
- The effect may use timing or motion data that cannot be represented exactly in the current editor.
- Try uploading a custom effect from Nanoleaf Jazz first and then reloading it from the Device Effects section.

If the app layout looks mirrored or rotated:

- Use the Orientation controls until the preview matches the physical wall.
