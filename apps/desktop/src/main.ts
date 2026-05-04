import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, screen, session } from "electron";
import type { Rectangle } from "electron";
import {
  createInitialPetRuntimeState,
  createManualEvent,
  reducePetEvent,
  tickPetState,
  type OpenPetsEvent,
} from "@openpets/core";
import type { OpenPetsHealthV2, OpenPetsWindowAction } from "@openpets/core/ipc";
import { getOpenPetsConfigPath, type OpenPetsConfig } from "@openpets/core/config";
import { loadCodexPetDirectory, type LoadedCodexPet } from "@openpets/pet-format-codex";
import { createDesktopIpcHandlers, startDesktopIpcServer, type DesktopIpcServerHandle } from "./ipc-server.js";

const CODEX_FRAME_WIDTH = 192;
const CODEX_FRAME_HEIGHT = 208;
const BASE_PIXEL_SCALE = 0.5;
const PET_SAFE_PAD_X = 12;
const PET_SAFE_PAD_TOP = 8;
const PET_SAFE_PAD_BOTTOM = 16;
const SPEECH_BUBBLE_SLOT_HEIGHT = 72;
const SPEECH_BUBBLE_MAX_OUTER_WIDTH = 168;
const MIN_WINDOW_WIDTH = 128;
const DEFAULT_PET_SCALE = 1;

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let runtimeState = createInitialPetRuntimeState();
let activePet: LoadedCodexPet | null = null;
let config: OpenPetsConfig = {};
let expirationTimer: ReturnType<typeof setTimeout> | null = null;
let ipcServerHandle: DesktopIpcServerHandle | null = null;
let debugMode = isDebugEnabled(process.argv);
let dragState: { startCursor: { x: number; y: number }; startBounds: Rectangle } | null = null;
let rendererReady = false;

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
}

app.on("second-instance", (_event, argv) => {
  void handleSecondInstance(argv);
});

app.whenReady().then(async () => {
  installSecurityHeaders();
  debugLog("app ready", { argv: process.argv, debugMode });
  config = await loadConfig();
  await applyArgv(process.argv);
  await startLocalIpcServer();
  await createPetWindow();
  publishState();
});

app.on("before-quit", () => {
  void ipcServerHandle?.close();
});

app.on("window-all-closed", () => {
  // Keep the pet process alive unless the user explicitly quits.
});

ipcMain.on("renderer-ready", () => {
  rendererReady = true;
  publishState();
});
ipcMain.on("window-action", (_event, action: unknown) => {
  if (isWindowAction(action)) {
    void handleWindowAction(action);
  }
});
ipcMain.on("pet-interaction", (_event, interaction: unknown) => handlePetInteraction(interaction));

async function createPetWindow() {
  const display = screen.getPrimaryDisplay();
  const { workArea } = display;
  const windowSize = getWindowContentSize();
  const initialPosition = config.position ?? {
    x: workArea.x + workArea.width - windowSize.width - 24,
    y: workArea.y + workArea.height - windowSize.height - 24,
  };
  const position = clampWindowPosition(initialPosition, windowSize);

  mainWindow = new BrowserWindow({
    width: windowSize.width,
    height: windowSize.height,
    useContentSize: true,
    x: position.x,
    y: position.y,
    transparent: !debugMode,
    frame: debugMode,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: debugMode,
    resizable: debugMode,
    movable: true,
    hasShadow: false,
    backgroundColor: debugMode ? "#1f2937" : "#00000000",
    show: false,
    fullscreenable: false,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
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

  debugLog("created window", { position, bounds: mainWindow.getBounds() });
  mainWindow.on("moved", () => void saveWindowPosition());
  mainWindow.webContents.on("did-finish-load", () => {
    debugLog("renderer did-finish-load");
    showPetWindow("did-finish-load");
    publishState();
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    debugLog("renderer did-fail-load", { errorCode, errorDescription, validatedURL });
  });
  mainWindow.once("ready-to-show", () => {
    debugLog("window ready-to-show");
    showPetWindow("ready-to-show");
  });
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
  showPetWindow("post-load");
  if (debugMode) mainWindow.webContents.openDevTools({ mode: "detach" });
}

function showPetWindow(reason: string) {
  if (!mainWindow || config.hidden) return;
  mainWindow.setAlwaysOnTop(true, "floating");
  if (debugMode) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    mainWindow.showInactive();
  }
  debugLog("show window", { reason, visible: mainWindow.isVisible(), bounds: mainWindow.getBounds() });
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
            "connect-src 'self' ws://127.0.0.1:5173 http://127.0.0.1:5173",
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

async function startLocalIpcServer() {
  if (ipcServerHandle) return;
  const handlers = createDesktopIpcHandlers({
    getHealth: getIpcHealth,
    applyEvent,
    handleWindowAction,
  });
  try {
    ipcServerHandle = await startDesktopIpcServer({
      handlers,
      onError: (error) => console.error(`OpenPets IPC server error: ${String(error)}`),
    });
    debugLog("ipc server started", { endpoint: ipcServerHandle.endpoint });
  } catch (error) {
    console.error(`OpenPets IPC server failed to start: ${String(error)}`);
    app.exit(1);
    return;
  }
}

function getIpcHealth(): OpenPetsHealthV2 {
  return {
    app: "openpets",
    ok: true,
    version: app.getVersion(),
    protocolVersion: 2,
    transport: "ipc",
    capabilities: ["event-v2", "window-v1", "speech-v1"],
    ready: Boolean(mainWindow && rendererReady && activePet),
    activePet: activePet?.id ?? null,
    debug: debugMode,
    window: mainWindow
      ? {
          visible: mainWindow.isVisible(),
          bounds: mainWindow.getBounds(),
          focused: mainWindow.isFocused(),
        }
      : null,
  };
}

function applyEvent(event: OpenPetsEvent) {
  runtimeState = reducePetEvent(tickPetState(runtimeState), event);
  publishState();
  scheduleExpiration();
}

function publishState() {
  resizeWindowForCurrentScale();
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
    showPetWindow("second-instance");
  }
  publishState();
}

async function applyArgv(argv: string[]) {
  debugMode = debugMode || isDebugEnabled(argv);
  const actionIndex = argv.indexOf("--openpets-action");
  const action = actionIndex >= 0 ? argv[actionIndex + 1] : undefined;

  const petIndex = argv.indexOf("--pet");
  const petPath = petIndex >= 0 ? argv[petIndex + 1] : undefined;
  const scaleIndex = argv.indexOf("--scale");
  const scaleValue = scaleIndex >= 0 ? Number(argv[scaleIndex + 1]) : NaN;
  if (Number.isFinite(scaleValue)) {
    config = { ...config, scale: normalizeScale(scaleValue) };
    await saveConfig(config);
    resizeWindowForCurrentScale();
  }
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
    } else {
      console.error(loaded.issues.map((item) => item.message).join("\n"));
      await loadDefaultPet();
    }
  } else {
    await loadDefaultPet();
  }

  if (action === "show" || action === "hide" || action === "sleep" || action === "quit") {
    await handleWindowAction(action);
  }
  return action;
}

async function handleWindowAction(action: OpenPetsWindowAction) {
  switch (action) {
    case "show":
      config = { ...config, hidden: false };
      await saveConfig(config);
      showPetWindow("show-action");
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

function handlePetInteraction(interaction: unknown) {
  if (!mainWindow || !interaction || typeof interaction !== "object") return;
  const record = interaction as Record<string, unknown>;
  const type = record.type;
  const screenX = typeof record.screenX === "number" ? record.screenX : 0;
  const screenY = typeof record.screenY === "number" ? record.screenY : 0;

  if (type === "click") {
    debugLog("pet click");
    return;
  }

  if (type === "drag-start") {
    dragState = {
      startCursor: { x: screenX, y: screenY },
      startBounds: mainWindow.getBounds(),
    };
    return;
  }

  if (type === "drag-move" && dragState) {
    const nextX = Math.round(dragState.startBounds.x + screenX - dragState.startCursor.x);
    const nextY = Math.round(dragState.startBounds.y + screenY - dragState.startCursor.y);
    const currentBounds = mainWindow.getBounds();
    if (currentBounds.x === nextX && currentBounds.y === nextY) return;
    mainWindow.setPosition(nextX, nextY, false);
    return;
  }

  if (type === "drag-end") {
    dragState = null;
    void saveWindowPosition();
  }
}

async function saveWindowPosition() {
  if (dragState) return;
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

async function loadDefaultPet() {
  const loaded = await loadCodexPetDirectory(getBundledDefaultPetPath());
  if (loaded.ok) {
    activePet = loaded.pet;
  } else {
    console.error(loaded.issues.map((item) => item.message).join("\n"));
  }
}

function getBundledDefaultPetPath() {
  if (app.isPackaged) {
    return join(process.resourcesPath, "pets", "slayer");
  }
  return resolve(__dirname, "../../../examples/pets/slayer");
}

function normalizeScale(scale: unknown) {
  return typeof scale === "number" && Number.isFinite(scale)
    ? Math.min(2, Math.max(0.25, scale))
    : DEFAULT_PET_SCALE;
}

function getVisualScale() {
  return normalizeScale(config.scale) * BASE_PIXEL_SCALE;
}

function getWindowContentSize() {
  const visualScale = getVisualScale();
  const petWidth = Math.ceil(CODEX_FRAME_WIDTH * visualScale);
  const petHeight = Math.ceil(CODEX_FRAME_HEIGHT * visualScale);
  return {
    width: Math.ceil(Math.max(petWidth + PET_SAFE_PAD_X * 2, SPEECH_BUBBLE_MAX_OUTER_WIDTH, MIN_WINDOW_WIDTH)),
    height: Math.ceil(SPEECH_BUBBLE_SLOT_HEIGHT + PET_SAFE_PAD_TOP + petHeight + PET_SAFE_PAD_BOTTOM),
  };
}

function clampWindowPosition(position: { x: number; y: number }, size: { width: number; height: number }) {
  const { workArea } = screen.getDisplayNearestPoint(position);
  return {
    x: clamp(position.x, workArea.x, workArea.x + workArea.width - size.width),
    y: clamp(position.y, workArea.y, workArea.y + workArea.height - size.height),
  };
}

function resizeWindowForCurrentScale() {
  if (!mainWindow) return;
  const size = getWindowContentSize();
  const [currentWidth, currentHeight] = mainWindow.getContentSize();
  if (currentWidth === size.width && currentHeight === size.height) return;

  const oldBounds = mainWindow.getBounds();
  const anchorX = oldBounds.x + oldBounds.width;
  const anchorY = oldBounds.y + oldBounds.height;
  mainWindow.setContentSize(size.width, size.height, false);

  const newBounds = mainWindow.getBounds();
  const { workArea } = screen.getDisplayMatching(oldBounds);
  const nextX = clamp(anchorX - newBounds.width, workArea.x, workArea.x + workArea.width - newBounds.width);
  const nextY = clamp(anchorY - newBounds.height, workArea.y, workArea.y + workArea.height - newBounds.height);
  mainWindow.setPosition(nextX, nextY, false);
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

function isDebugEnabled(argv: string[]) {
  return process.env.OPENPETS_DEBUG === "1" || argv.includes("--debug") || argv.includes("--openpets-debug");
}

function debugLog(message: string, details?: unknown) {
  if (!debugMode) return;
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.error(`[openpets:debug] ${message}${suffix}`);
}
