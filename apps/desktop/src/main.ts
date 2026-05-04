import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, screen, session } from "electron";
import {
  createInitialPetRuntimeState,
  createManualEvent,
  reducePetEvent,
  tickPetState,
  validateOpenPetsEvent,
  type OpenPetsEvent,
} from "@openpets/core";
import { getOpenPetsConfigPath, type OpenPetsConfig } from "@openpets/core/config";
import { loadCodexPetDirectory, type LoadedCodexPet } from "@openpets/pet-format-codex";

const PORT = 4738;
const HOST = "127.0.0.1";
const STARTUP_WIDTH = 240;
const STARTUP_HEIGHT = 260;

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let runtimeState = createInitialPetRuntimeState();
let activePet: LoadedCodexPet | null = null;
let config: OpenPetsConfig = {};
let expirationTimer: ReturnType<typeof setTimeout> | null = null;
let serverStarted = false;

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
}

app.on("second-instance", (_event, argv) => {
  void handleSecondInstance(argv);
});

app.whenReady().then(async () => {
  installSecurityHeaders();
  config = await loadConfig();
  await applyArgv(process.argv);
  startLocalServer();
  await createPetWindow();
  publishState();
});

app.on("window-all-closed", () => {
  // Keep the pet process alive unless the user explicitly quits.
});

ipcMain.on("renderer-ready", () => publishState());
ipcMain.on("window-action", (_event, action: unknown) => {
  if (isWindowAction(action)) {
    void handleWindowAction(action);
  }
});

async function createPetWindow() {
  const display = screen.getPrimaryDisplay();
  const { workArea } = display;
  const position = config.position ?? {
    x: workArea.x + workArea.width - STARTUP_WIDTH - 24,
    y: workArea.y + workArea.height - STARTUP_HEIGHT - 24,
  };

  mainWindow = new BrowserWindow({
    width: STARTUP_WIDTH,
    height: STARTUP_HEIGHT,
    x: position.x,
    y: position.y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    movable: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    show: false,
    fullscreenable: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
  });

  mainWindow.on("moved", () => void saveWindowPosition());
  hardenWindowNavigation(mainWindow);

  try {
    if (app.isPackaged) {
      await mainWindow.loadFile(join(__dirname, "renderer", "index.html"));
    } else {
      await mainWindow.loadURL("http://127.0.0.1:5173");
    }
  } catch (error) {
    const fallbackRenderer = join(__dirname, "renderer", "index.html");
    console.error(`OpenPets renderer load failed; trying built renderer. ${String(error)}`);
    await mainWindow.loadFile(fallbackRenderer).catch((fallbackError) => {
      console.error(`OpenPets built renderer load failed. ${String(fallbackError)}`);
    });
  }

  mainWindow.once("ready-to-show", () => {
    if (!config.hidden) {
      mainWindow?.showInactive();
    }
    mainWindow?.setAlwaysOnTop(true, "floating");
  });
}

function installSecurityHeaders() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' file: data:",
            "connect-src 'self' http://127.0.0.1:4738 ws://127.0.0.1:5173 http://127.0.0.1:5173",
            "object-src 'none'",
            "base-uri 'none'",
            "frame-ancestors 'none'",
          ].join("; "),
        ],
      },
    });
  });
}

function hardenWindowNavigation(window: BrowserWindow) {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedRendererNavigation(url)) {
      event.preventDefault();
    }
  });
}

function isAllowedRendererNavigation(url: string) {
  return url === "http://127.0.0.1:5173/" || url.startsWith(pathToFileURL(join(__dirname, "renderer")).href);
}

function startLocalServer() {
  if (serverStarted) return;
  serverStarted = true;
  const server = createServer((request, response) => {
    void handleRequest(request, response);
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`OpenPets port ${PORT} is already in use.`);
    } else {
      console.error(error);
    }
  });

  server.listen(PORT, HOST);
}

async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  if (request.url === "/health" && request.method === "GET") {
    return json(response, 200, {
      app: "openpets",
      ok: true,
      version: app.getVersion(),
      ready: Boolean(mainWindow),
      activePet: activePet?.id ?? null,
    });
  }

  if (request.url === "/event" && request.method === "POST") {
    return handleEventRequest(request, response);
  }

  if (request.url === "/event") {
    return json(response, 405, { ok: false, error: "Method not allowed" });
  }

  return json(response, 404, { ok: false, error: "Not found" });
}

async function handleEventRequest(request: IncomingMessage, response: ServerResponse) {
  const contentType = request.headers["content-type"]?.toLowerCase() ?? "";
  if (contentType.split(";")[0]?.trim() !== "application/json") {
    return json(response, 415, { ok: false, error: "Unsupported content type" });
  }

  const origin = request.headers.origin;
  if (origin) {
    return json(response, 403, { ok: false, error: "Browser-origin requests are not allowed" });
  }

  const body = await readRequestBody(request, 16 * 1024).catch((error) => error);
  if (body instanceof Error) {
    return json(response, body.message === "Payload too large" ? 413 : 400, {
      ok: false,
      error: body.message,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return json(response, 400, { ok: false, error: "Invalid JSON" });
  }

  const validation = validateOpenPetsEvent(parsed);
  if (!validation.ok) {
    return json(response, 400, { ok: false, error: validation.error });
  }

  applyEvent(validation.event);
  return json(response, 200, { ok: true, state: validation.event.state });
}

function applyEvent(event: OpenPetsEvent) {
  runtimeState = reducePetEvent(tickPetState(runtimeState), event);
  publishState();
  scheduleExpiration();
}

function publishState() {
  mainWindow?.webContents.send("pet-state", {
    state: runtimeState.rendered,
    event: runtimeState.event,
    activePet: activePet ? { ...activePet, spritesheetUrl: pathToFileURL(activePet.spritesheetPath).href } : null,
    scale: normalizeScale(config.scale),
  });
}

async function handleSecondInstance(argv: string[]) {
  const action = await applyArgv(argv);
  if (action !== "hide" && action !== "quit") {
    mainWindow?.showInactive();
  }
  publishState();
}

async function applyArgv(argv: string[]) {
  const actionIndex = argv.indexOf("--openpets-action");
  const action = actionIndex >= 0 ? argv[actionIndex + 1] : undefined;

  const petIndex = argv.indexOf("--pet");
  const petPath = petIndex >= 0 ? argv[petIndex + 1] : undefined;
  if (petPath) {
    const loaded = await loadCodexPetDirectory(resolve(petPath));
    if (loaded.ok) {
      activePet = loaded.pet;
      config = { ...config, petPath: activePet.directory };
      await saveConfig(config);
    } else {
      console.error(loaded.issues.map((item) => item.message).join("\n"));
    }
  } else if (config.petPath) {
    const loaded = await loadCodexPetDirectory(config.petPath);
    if (loaded.ok) {
      activePet = loaded.pet;
    }
  } else {
    const loaded = await loadCodexPetDirectory(getBundledSamplePetPath());
    if (loaded.ok) {
      activePet = loaded.pet;
    } else {
      console.error(loaded.issues.map((item) => item.message).join("\n"));
    }
  }

  if (action === "show" || action === "hide" || action === "sleep" || action === "quit") {
    await handleWindowAction(action);
  }
  return action;
}

async function handleWindowAction(action: "show" | "hide" | "sleep" | "quit") {
  switch (action) {
    case "show":
      config = { ...config, hidden: false };
      await saveConfig(config);
      mainWindow?.showInactive();
      break;
    case "hide":
      config = { ...config, hidden: true };
      await saveConfig(config);
      mainWindow?.hide();
      break;
    case "sleep":
      applyEvent(createManualEvent("sleeping", { source: "desktop" }));
      break;
    case "quit":
      app.exit(0);
      break;
  }
}

function isWindowAction(action: unknown): action is "show" | "hide" | "sleep" | "quit" {
  return action === "show" || action === "hide" || action === "sleep" || action === "quit";
}

async function saveWindowPosition() {
  const bounds = mainWindow?.getBounds();
  if (!bounds) return;
  config = { ...config, position: { x: bounds.x, y: bounds.y } };
  await saveConfig(config);
}

async function loadConfig(): Promise<OpenPetsConfig> {
  try {
    const content = await readFile(getOpenPetsConfigPath(), "utf8");
    return JSON.parse(content) as OpenPetsConfig;
  } catch {
    return {};
  }
}

async function saveConfig(nextConfig: OpenPetsConfig) {
  const configPath = getOpenPetsConfigPath();
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`);
}

function scheduleExpiration() {
  if (expirationTimer) {
    clearTimeout(expirationTimer);
    expirationTimer = null;
  }
  if (runtimeState.temporaryUntil === null) return;
  const delay = Math.max(0, runtimeState.temporaryUntil - Date.now());
  expirationTimer = setTimeout(() => {
    runtimeState = tickPetState(runtimeState);
    publishState();
    scheduleExpiration();
  }, delay + 5);
}

function getBundledSamplePetPath() {
  if (app.isPackaged) {
    return join(process.resourcesPath, "sample-pet");
  }
  return resolve(__dirname, "../../../examples/sample-pet");
}

function normalizeScale(scale: unknown) {
  return typeof scale === "number" && Number.isFinite(scale)
    ? Math.min(2, Math.max(0.25, scale))
    : 0.8;
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readRequestBody(request: IncomingMessage, maxBytes: number) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) {
      throw new Error("Payload too large");
    }
  }
  return body;
}
