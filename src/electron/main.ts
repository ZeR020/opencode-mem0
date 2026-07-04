import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type WebServer } from "../services/web-server.js";
import { CONFIG, initConfig, isConfigured } from "../config.js";
import { memoryClient } from "../services/client.js";
import { log } from "../services/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, "..");

let mainWindow: BrowserWindow | null = null;
let webServer: WebServer | null = null;

const isDev = process.argv.includes("--dev");

/**
 * Initialize the same configuration and memory client warmup that the
 * OpenCode plugin performs before starting the web server. This ensures
 * the database and vector backend are ready when the dashboard loads.
 */
async function initializeBackend(): Promise<void> {
  initConfig(process.cwd());

  if (!isConfigured()) {
    log(
      "Electron dashboard: memory backend not configured; dashboard will use whatever is available"
    );
    return;
  }

  try {
    const timeoutMs = CONFIG.warmupTimeoutMs ?? 30000;
    await Promise.race([
      memoryClient.warmup(),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error(`Warmup timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  } catch (error) {
    log("Electron dashboard warmup failed", { error: String(error) });
  }
}

/**
 * Start the local web server that backs the dashboard.
 * Reuses the same WebServer used by the OpenCode plugin, so it will
 * bind to the port if free or attach to an already-running instance.
 */
async function startDashboardServer(): Promise<WebServer> {
  webServer = await startWebServer({
    port: CONFIG.webServerPort,
    host: CONFIG.webServerHost,
    enabled: CONFIG.webServerEnabled,
    apiKey: CONFIG.webServerApiKey,
  });
  return webServer;
}

/**
 * Create the main dashboard window and load the web UI from the local server.
 */
function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 640,
    minHeight: 480,
    title: "OpenCode Memory Dashboard",
    backgroundColor: "#fdfcfc",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const url = webServer?.getUrl() ?? `http://${CONFIG.webServerHost}:${CONFIG.webServerPort}`;
  void mainWindow.loadURL(url);

  // Open external links in the system browser, not inside the Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (targetUrl.startsWith("http:")) {
      void shell.openExternal(targetUrl);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
}

async function main(): Promise<void> {
  await app.whenReady();

  try {
    await initializeBackend();
  } catch (error) {
    log("Electron dashboard backend initialization error", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await startDashboardServer();
  } catch (error) {
    log("Electron dashboard failed to start web server", {
      error: error instanceof Error ? error.message : String(error),
    });
    app.quit();
    return;
  }

  createMainWindow();

  app.on("window-all-closed", () => {
    // Keep the web server running for OpenCode / other clients on macOS.
    if (process.platform !== "darwin") {
      webServer?.stop();
      app.quit();
    }
  });

  app.on("activate", () => {
    if (mainWindow === null) {
      createMainWindow();
    } else {
      mainWindow.focus();
    }
  });
}

void main();
