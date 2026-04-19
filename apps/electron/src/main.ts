import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { app, BrowserWindow, dialog, shell } from "electron";
import { startBridgeServer, type BridgeRuntime } from "../../bridge/src/server";

let mainWindow: BrowserWindow | null = null;
let runtime: BridgeRuntime | null = null;

function resolveWebDist(): string {
  const candidates = [
    process.env.NANOLEAF_JAZZ_WEB_DIST,
    app.isPackaged ? join(process.resourcesPath, "web") : undefined,
    resolve(process.cwd(), "apps/web/dist")
  ].filter((candidate): candidate is string => Boolean(candidate));

  const webDist = candidates.find((candidate) => existsSync(join(candidate, "index.html")));
  if (!webDist) {
    throw new Error(`Unable to locate packaged web UI. Tried: ${candidates.join(", ")}`);
  }

  return webDist;
}

async function createMainWindow() {
  runtime = await startBridgeServer({
    host: "127.0.0.1",
    port: Number.parseInt(process.env.PORT ?? "0", 10),
    webDist: resolveWebDist(),
    logger: !app.isPackaged
  });

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 960,
    minHeight: 680,
    title: "Nanoleaf Jazz",
    backgroundColor: "#10131a",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(runtime.url);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", async (event) => {
    if (!runtime) {
      return;
    }

    event.preventDefault();
    const runtimeToClose = runtime;
    runtime = null;
    await runtimeToClose.close();
    app.quit();
  });

  app.whenReady()
    .then(createMainWindow)
    .catch((error) => {
      dialog.showErrorBox("Nanoleaf Jazz failed to start", error instanceof Error ? error.message : String(error));
      app.quit();
    });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
}
