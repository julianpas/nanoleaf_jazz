import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(root, "release", "browser-launcher");
const webDist = join(root, "apps", "web", "dist");
const launcherEntry = join(root, "apps", "browser-launcher", "dist", "main.cjs");
const executableName = process.platform === "win32" ? "NanoleafJazz-Browser.exe" : "nanoleaf-jazz-browser";
const executablePath = join(outputDir, executableName);

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await cp(webDist, join(outputDir, "web"), { recursive: true });

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
