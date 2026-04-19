import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { startBridgeServer, type BridgeRuntime } from "../../bridge/src/server";

function resolveWebDist(): string {
  const candidates = [
    process.env.NANOLEAF_JAZZ_WEB_DIST,
    join(dirname(process.execPath), "web"),
    resolve(process.cwd(), "web"),
    resolve(process.cwd(), "apps/web/dist")
  ].filter((candidate): candidate is string => Boolean(candidate));

  const webDist = candidates.find((candidate) => existsSync(join(candidate, "index.html")));
  if (!webDist) {
    throw new Error(`Unable to locate packaged web UI. Tried: ${candidates.join(", ")}`);
  }

  return webDist;
}

function openDefaultBrowser(url: string) {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    }).unref();
    return;
  }

  const command = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(command, [url], {
    detached: true,
    stdio: "ignore"
  }).unref();
}

async function shutdown(runtime: BridgeRuntime) {
  try {
    await runtime.close();
  } finally {
    process.exit(0);
  }
}

async function main() {
  process.title = "Nanoleaf Jazz";

  const runtime = await startBridgeServer({
    host: "127.0.0.1",
    port: Number.parseInt(process.env.PORT ?? "0", 10),
    webDist: resolveWebDist(),
    logger: false
  });

  console.log(`Nanoleaf Jazz is running at ${runtime.url}`);
  openDefaultBrowser(runtime.url);

  process.on("SIGINT", () => void shutdown(runtime));
  process.on("SIGTERM", () => void shutdown(runtime));
  process.stdin.resume();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
