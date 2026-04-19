import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(root, "release", "browser-launcher");
const webDist = join(root, "apps", "web", "dist");
const launcherEntry = join(root, "apps", "browser-launcher", "dist", "main.cjs");
const launcherIconIco = join(root, "apps", "browser-launcher", "build", "icon.ico");
const launcherIconPng = join(root, "apps", "browser-launcher", "build", "icon.png");
const executableName = process.platform === "win32" ? "NanoleafJazz-Browser.exe" : "nanoleaf-jazz-browser";
const executablePath = join(outputDir, executableName);

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await cp(webDist, join(outputDir, "web"), { recursive: true });
if (existsSync(launcherIconPng)) {
  await cp(launcherIconPng, join(outputDir, "icon.png"));
}
if (existsSync(launcherIconIco)) {
  await cp(launcherIconIco, join(outputDir, "icon.ico"));
}

const pkgCommand = "npx";
const pkgResult = spawnSync(
  pkgCommand,
  ["pkg", launcherEntry, "--targets", process.env.BROWSER_LAUNCHER_TARGETS ?? "host", "--output", executablePath],
  {
    cwd: root,
    shell: process.platform === "win32",
    stdio: "inherit"
  }
);

if (pkgResult.status !== 0) {
  process.exit(pkgResult.status ?? 1);
}

if (process.platform === "win32" && existsSync(launcherIconIco)) {
  const rceditPath = join(root, "node_modules", "electron-winstaller", "vendor", "rcedit.exe");
  if (existsSync(rceditPath)) {
    const rceditResult = spawnSync(
      rceditPath,
      [
        executablePath,
        "--set-icon",
        launcherIconIco,
        "--set-version-string",
        "FileDescription",
        "Nanoleaf Jazz Browser Launcher",
        "--set-version-string",
        "ProductName",
        "Nanoleaf Jazz Browser Launcher",
        "--set-version-string",
        "CompanyName",
        "Julian Pastarmov"
      ],
      {
        cwd: root,
        stdio: "inherit"
      }
    );

    if (rceditResult.status !== 0) {
      process.exit(rceditResult.status ?? 1);
    }
  } else {
    console.warn("rcedit.exe was not found; browser launcher executable icon was not embedded.");
  }
}

await writeFile(
  join(outputDir, "README.txt"),
  [
    "Nanoleaf Jazz Browser Launcher",
    "",
    `Run ${executableName}.`,
    "The launcher starts the local Nanoleaf Jazz bridge and opens the default browser.",
    "Keep the web folder next to the executable; it contains the packaged UI.",
    "",
    "The app stores device pairing tokens in the current user's .nanoleaf-jazz config folder."
  ].join("\n"),
  "utf8"
);

console.log(`Browser launcher release written to ${outputDir}`);
