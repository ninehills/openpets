import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, screen, session, shell, Tray } from "electron";
import type { MenuItemConstructorOptions, Rectangle, WebContents } from "electron";
import {
  createInitialPetRuntimeState,
  createLifecycleLeaseState,
  createManualEvent,
  applyLeaseAction,
  getActiveLeaseCount,
  reducePetEvent,
  tickPetState,
  type LeaseParams,
  parseSource,
  type OpenPetsEvent,
  type PetRuntimeState,
} from "@open-pets/core";
import type { OpenPetsHealthV2, OpenPetsWindowAction } from "@open-pets/core/ipc";
import {
  ONBOARDING_VERSION,
  createOnboardingState,
  getOpenPetsConfigPath,
  getOpenPetsPetsDir,
  shouldOpenOnboarding,
  type OpenPetsConfig,
} from "@open-pets/core/config";
import { loadCodexPetDirectory, type LoadedCodexPet } from "@open-pets/pet-format-codex";
import { registerAssistantSetupIpc } from "./assistant-setup/ipc.js";
import { createDetectionContext, detectAssistantSetups, getAssistantSetupAdapter } from "./assistant-setup/registry.js";
import { parsePreviewToken } from "./assistant-setup/tokens.js";
import { openAssistantSetupWindow } from "./assistant-setup/window.js";
import { createDesktopIpcHandlers, startDesktopIpcServer, type DesktopIpcServerHandle } from "./ipc-server.js";
import { installCliShim } from "./menu-actions/cli-shim.js";
import { GENERIC_MCP_CONFIG, INTEGRATIONS_DOCS_URL, PET_GALLERY_URL } from "./menu-actions/constants.js";
import { registerOnboardingIpc } from "./onboarding/ipc.js";
import { closeOnboardingWindow, openOnboardingWindow } from "./onboarding/window.js";

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
const STARTER_PET_ID = "slayer";
const DEFAULT_INSTANCE_ID = "__default__";
const DISCONNECT_CLOSE_DELAY_MS = 10_000;
const CASCADE_OFFSET_PX = 120;

const __dirname = dirname(fileURLToPath(import.meta.url));

type PetInstance = {
  leaseId: string;
  agentType: string;
  detail: string;
  pet: LoadedCodexPet | null;
  runtime: PetRuntimeState;
  window: BrowserWindow | null;
  rendererReady: boolean;
  expirationTimer: ReturnType<typeof setTimeout> | null;
  disconnectTimer?: ReturnType<typeof setTimeout>;
};

let mainWindow: BrowserWindow | null = null;
let lifecycleState = createLifecycleLeaseState({ managed: false });
let activePet: LoadedCodexPet | null = null;
let defaultPet: LoadedCodexPet | null = null;
let installedPets: LoadedCodexPet[] = [];
let petInstances = new Map<string, PetInstance>();
let config: OpenPetsConfig = {};
let ipcServerHandle: DesktopIpcServerHandle | null = null;
let tray: Tray | null = null;
let debugMode = isDebugEnabled(process.argv);
let dragState: { window: BrowserWindow; startCursor: { x: number; y: number }; startBounds: Rectangle } | null = null;

if (process.platform === "darwin") {
  // OpenPets does not store secrets. Avoid Chromium initializing macOS
  // Keychain-backed Safe Storage and showing a confusing permission prompt.
  app.commandLine.appendSwitch("use-mock-keychain");
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
}

app.on("second-instance", (_event, argv) => {
  void handleSecondInstance(argv);
});

app.whenReady().then(async () => {
  hideDockIcon();
  Menu.setApplicationMenu(null);
  installSecurityHeaders();
  registerAssistantSetupIpc();
  registerOnboardingIpc({
    getState: getOnboardingSnapshot,
    skip: markOnboardingSkipped,
    complete: markOnboardingCompleted,
    close: closeOnboardingWindow,
    detectAssistants: async () => {
      return detectAssistantSetups(createDetectionContext());
    },
    previewAssistant: async (assistantId) => {
      return getAssistantSetupAdapter(assistantId).preview(createDetectionContext());
    },
    applyAssistantSetup: async (previewToken) => {
      const parsed = parsePreviewToken(previewToken);
      if (!parsed) throw new Error("Invalid preview token.");
      return getAssistantSetupAdapter(parsed.assistantId).apply(createDetectionContext(), { previewToken: parsed.token });
    },
    testConnection: async () => {
      const health = getIpcHealth();
      return {
        ok: health.ready,
        message: health.ready ? "OpenPets desktop IPC is reachable and ready." : "OpenPets is running, but the desktop pet is not ready yet.",
        checklist: [
          { label: "Desktop app running", ok: health.ok, detail: `OpenPets ${health.version}` },
          { label: "Pet renderer ready", ok: health.ready, detail: health.activePet ? `Active pet: ${health.activePet}` : "No active pet yet" },
          { label: "Assistant lease connected", ok: health.activeLeases > 0, detail: `${health.activeLeases} active lease${health.activeLeases === 1 ? "" : "s"}` },
        ],
      };
    },
    listStarterPets,
    adoptStarterPet,
  });
  debugLog("app ready", { argv: process.argv, debugMode });
  config = await loadConfig();
  await applyArgv(process.argv);
  installedPets = await loadInstalledPets();
  await startLocalIpcServer();
  createTray();
  await ensureDefaultPet();
  await maybeOpenOnboardingWindow(process.argv);
  publishAllStates();
});

app.on("before-quit", () => {
  void ipcServerHandle?.close();
});

app.on("window-all-closed", () => {
  // Keep the pet process alive unless the user explicitly quits.
});

ipcMain.on("renderer-ready", (event) => {
  const instance = getInstanceByWebContents(event.sender);
  if (instance) {
    instance.rendererReady = true;
    publishStateForInstance(instance);
  }
});
ipcMain.on("window-action", (_event, action: unknown) => {
  if (isWindowAction(action)) {
    void handleWindowAction(action);
  }
});
ipcMain.on("pet-interaction", (event, interaction: unknown) => handlePetInteraction(event.sender, interaction));

async function createPetWindow() {
  await ensureDefaultPet();
}

async function createWindowForInstance(instance: PetInstance) {
  const display = screen.getPrimaryDisplay();
  const { workArea } = display;
  const windowSize = getWindowContentSize();
  const position = instance.leaseId === DEFAULT_INSTANCE_ID
    ? clampWindowPosition(config.position ?? {
        x: workArea.x + workArea.width - windowSize.width - 24,
        y: workArea.y + workArea.height - windowSize.height - 24,
      }, windowSize)
    : getCascadePosition();

  const window = new BrowserWindow({
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

  instance.window = window;
  if (instance.leaseId === DEFAULT_INSTANCE_ID || !mainWindow) mainWindow = window;
  debugLog("created window", { leaseId: instance.leaseId, position, bounds: window.getBounds() });
  window.on("moved", () => {
    if (instance.leaseId === DEFAULT_INSTANCE_ID) void saveWindowPosition(window);
  });
  window.on("closed", () => {
    instance.window = null;
    if (mainWindow === window) mainWindow = getMainWindow();
  });
  window.webContents.on("did-finish-load", () => {
    debugLog("renderer did-finish-load", { leaseId: instance.leaseId });
    showPetWindowForInstance(instance, "did-finish-load");
    publishStateForInstance(instance);
  });
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    debugLog("renderer did-fail-load", { errorCode, errorDescription, validatedURL });
  });
  window.once("ready-to-show", () => {
    debugLog("window ready-to-show", { leaseId: instance.leaseId });
    showPetWindowForInstance(instance, "ready-to-show");
  });
  hardenWindowNavigation(window);

  try {
    if (app.isPackaged) {
      await window.loadFile(join(__dirname, "renderer", "index.html"));
    } else {
      await window.loadURL("http://127.0.0.1:5173");
    }
  } catch (error) {
    const fallbackRenderer = join(__dirname, "renderer", "index.html");
    console.error(`OpenPets renderer load failed; trying built renderer. ${String(error)}`);
    await window.loadFile(fallbackRenderer).catch((fallbackError) => {
      console.error(`OpenPets built renderer load failed. ${String(fallbackError)}`);
    });
  }
  showPetWindowForInstance(instance, "post-load");
  if (debugMode) window.webContents.openDevTools({ mode: "detach" });
}

function showPetWindow(reason: string) {
  for (const instance of petInstances.values()) showPetWindowForInstance(instance, reason);
}

function showPetWindowForInstance(instance: PetInstance, reason: string) {
  const window = instance.window;
  if (!window || config.hidden) return;
  window.setAlwaysOnTop(true, "floating");
  if (debugMode) {
    window.show();
    window.focus();
  } else {
    window.showInactive();
  }
  debugLog("show window", { reason, leaseId: instance.leaseId, visible: window.isVisible(), bounds: window.getBounds() });
}

function hideDockIcon() {
  if (process.platform === "darwin") {
    app.dock?.hide();
  }
}

function createTray() {
  if (tray) return;
  tray = new Tray(getTrayIcon());
  tray.setToolTip("OpenPets");
  tray.on("double-click", () => {
    void handleWindowAction(config.hidden || !mainWindow?.isVisible() ? "show" : "hide");
  });
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(createTrayMenuTemplate()));
}

function createTrayMenuTemplate(): MenuItemConstructorOptions[] {
  const scale = normalizeScale(config.scale);
  const activePetLabel = activePet?.displayName ? `Pet: ${activePet.displayName}` : "Pet: Loading…";
  return [
    { label: "OpenPets", enabled: false },
    { type: "separator" },
    {
      label: config.hidden ? "Show Pet" : "Hide Pet",
      click: () => void handleWindowAction(config.hidden ? "show" : "hide"),
    },
    {
      label: "Sleep",
      click: () => void handleWindowAction("sleep"),
    },
    {
      label: "Setup AI Assistants",
      click: () => void openAssistantSetupWindow({ dirname: __dirname, debugMode }),
    },
    {
      label: "Copy MCP Config",
      click: () => void copyMcpConfig(),
    },
    {
      label: "Open Integrations Docs",
      click: () => void openAllowlistedExternalUrl("Open Integrations Docs", INTEGRATIONS_DOCS_URL),
    },
    {
      label: "Install CLI Command",
      click: () => void installCliCommand(),
    },
    {
      label: "Open Pet Gallery",
      click: () => void openAllowlistedExternalUrl("Open Pet Gallery", PET_GALLERY_URL),
    },
    {
      label: "Open First-Run Guide",
      click: () => void openOnboardingWindow({ dirname: __dirname, debugMode, forced: true }),
    },
    { type: "separator" },
    {
      label: activePetLabel,
      enabled: false,
    },
    {
      label: "Select Pet",
      submenu: createInstalledPetsSubmenu(),
    },
    {
      label: "Scale",
      submenu: [0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => ({
        label: `${Math.round(value * 100)}%`,
        type: "radio" as const,
        checked: Math.abs(scale - value) < 0.001,
        click: () => void setPetScale(value),
      })),
    },
    { type: "separator" },
    {
      label: "Settings",
      submenu: [
        {
          label: "Open Config File",
          click: () => void openConfigFile(),
        },
        {
          label: "Reveal Config Folder",
          click: () => void revealConfigFolder(),
        },
        {
          label: `Active leases: ${getActiveLeaseCount(lifecycleState)}`,
          enabled: false,
        },
        {
          label: `Mode: ${lifecycleState.managed ? "Managed" : "Manual"}`,
          enabled: false,
        },
      ],
    },
    { type: "separator" },
    {
      label: "Quit OpenPets",
      click: () => void handleWindowAction("quit"),
    },
  ];
}

function createInstalledPetsSubmenu(): MenuItemConstructorOptions[] {
  return [
    {
      label: "Default",
      type: "radio" as const,
      checked: !config.petPath,
      click: () => void useDefaultPet(),
    },
    ...installedPets.map((pet) => ({
      label: pet.displayName || pet.id,
      type: "radio" as const,
      checked: activePet?.directory === pet.directory,
      click: () => void selectInstalledPet(pet.directory),
    })),
  ];
}

function getTrayIcon() {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, "assets", "tray-icon.png")]
    : [join(__dirname, "../../../assets/tray-icon.png")];
  for (const candidate of candidates) {
    const image = nativeImage.createFromPath(candidate);
    if (!image.isEmpty()) return image.resize({ width: 18, height: 18, quality: "best" });
  }
  return nativeImage.createEmpty();
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
    handleLease,
    selectPet,
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

async function ensureDefaultPet() {
  if (petInstances.size > 0) return;
  const instance = createPetInstance(DEFAULT_INSTANCE_ID, "default", defaultPet);
  petInstances.set(instance.leaseId, instance);
  await createWindowForInstance(instance);
}

async function createForLease(leaseId: string, source: string) {
  const existing = petInstances.get(leaseId);
  if (existing) {
    if (existing.disconnectTimer) {
      clearTimeout(existing.disconnectTimer);
      delete existing.disconnectTimer;
    }
    // Re-resolve pet in case the default pet or agent config changed
    existing.pet = await resolvePetForSource(source);
    return existing;
  }
  if (petInstances.size === 1 && petInstances.has(DEFAULT_INSTANCE_ID)) {
    destroyForLease(DEFAULT_INSTANCE_ID);
  }
  const instance = createPetInstance(leaseId, source, await resolvePetForSource(source));
  petInstances.set(leaseId, instance);
  await createWindowForInstance(instance);
  return instance;
}

function createPetInstance(leaseId: string, source: string, pet: LoadedCodexPet | null): PetInstance {
  const parsed = parseSource(source);
  return {
    leaseId,
    agentType: parsed.agentType,
    detail: parsed.detail,
    pet,
    runtime: createInitialPetRuntimeState(),
    window: null,
    rendererReady: false,
    expirationTimer: null,
  };
}

function scheduleDestroyForLease(leaseId: string) {
  const instance = petInstances.get(leaseId);
  if (!instance || leaseId === DEFAULT_INSTANCE_ID) return;
  if (instance.disconnectTimer) clearTimeout(instance.disconnectTimer);
  instance.disconnectTimer = setTimeout(() => {
    destroyForLease(leaseId);
    void ensureDefaultPet();
  }, DISCONNECT_CLOSE_DELAY_MS);
  instance.disconnectTimer.unref?.();
}

function destroyForLease(leaseId: string, closeWindow = true) {
  const instance = petInstances.get(leaseId);
  if (!instance) return;
  if (instance.expirationTimer) clearTimeout(instance.expirationTimer);
  if (instance.disconnectTimer) clearTimeout(instance.disconnectTimer);
  if (closeWindow) instance.window?.close();
  petInstances.delete(leaseId);
  mainWindow = getMainWindow();
}

function getMainWindow() {
  return petInstances.get(DEFAULT_INSTANCE_ID)?.window ?? petInstances.values().next().value?.window ?? null;
}

function getDefaultInstance() {
  return petInstances.get(DEFAULT_INSTANCE_ID) ?? petInstances.values().next().value ?? null;
}

function getInstanceByWebContents(contents: WebContents) {
  for (const instance of petInstances.values()) {
    if (instance.window?.webContents === contents) return instance;
  }
  return null;
}

function setDefaultPet(pet: LoadedCodexPet) {
  activePet = pet;
  defaultPet = pet;
  const defaultInstance = petInstances.get(DEFAULT_INSTANCE_ID);
  if (defaultInstance) defaultInstance.pet = pet;
}

async function resolvePetForSource(source: string) {
  const { agentType } = parseSource(source);
  const configured = config.agents?.[agentType];
  if (!configured) return defaultPet;
  const found = installedPets.find((pet) => pet.id === configured || pet.displayName === configured);
  return found ?? defaultPet;
}

function getCascadePosition() {
  const display = screen.getPrimaryDisplay();
  const { workArea } = display;
  const windowSize = getWindowContentSize();
  const base = config.position ?? {
    x: workArea.x + workArea.width - windowSize.width - 24,
    y: workArea.y + workArea.height - windowSize.height - 24,
  };
  const index = Math.max(0, petInstances.size);
  const columns = Math.max(1, Math.floor((workArea.x + workArea.width - base.x) / CASCADE_OFFSET_PX));
  const x = base.x + (index % columns) * CASCADE_OFFSET_PX;
  let y = base.y + Math.floor(index / columns) * CASCADE_OFFSET_PX;
  if (y + windowSize.height > workArea.y + workArea.height) y = base.y;
  return clampWindowPosition({ x, y }, windowSize);
}

function getIpcHealth(): OpenPetsHealthV2 {
  return {
    app: "openpets",
    ok: true,
    version: app.getVersion(),
    protocolVersion: 2,
    transport: "ipc",
    capabilities: ["event-v2", "window-v1", "speech-v1", "lease-v1", "pet-v1", "multi-pet-v1"],
    ready: Array.from(petInstances.values()).some((instance) => instance.window && instance.rendererReady && instance.pet),
    activePet: getDefaultInstance()?.pet?.id ?? null,
    activePets: Array.from(petInstances.values()).map((instance) => ({
      leaseId: instance.leaseId,
      agentType: instance.agentType,
      detail: instance.detail,
      petName: instance.pet?.id ?? null,
      state: instance.runtime.rendered,
    })),
    activeLeases: getActiveLeaseCount(lifecycleState),
    managed: lifecycleState.managed,
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

async function handleLease(params: LeaseParams) {
  const result = applyLeaseAction(lifecycleState, params);
  if (!result.ok) {
    const error = new Error(result.error) as Error & { code: "invalid-params" };
    error.code = "invalid-params";
    throw error;
  }
  if (params.action === "acquire") {
    await createForLease(params.id, params.id);
  } else if (params.action === "heartbeat") {
    const instance = petInstances.get(params.id);
    if (instance?.disconnectTimer) {
      clearTimeout(instance.disconnectTimer);
      delete instance.disconnectTimer;
    }
    // Recover from server restart: if heartbeat arrives for an unknown lease
    // the client thinks it's active but we have no instance. Create one.
    if (!instance) {
      void createForLease(params.id, params.id);
    }
  } else if (params.action === "release") {
    scheduleDestroyForLease(params.id);
  }
  updateTrayMenu();
  return result.result;
}

function applyEvent(event: OpenPetsEvent) {
  const instance = getInstanceForEvent(event);
  if (!instance) return;
  instance.runtime = reducePetEvent(tickPetState(instance.runtime), event);
  publishStateForInstance(instance);
  scheduleExpirationForInstance(instance);
}

function getInstanceForEvent(event: OpenPetsEvent) {
  if (event.leaseId) {
    const existing = petInstances.get(event.leaseId);
    if (existing) return existing;
    return createAutoInstance(event.leaseId, event.source || event.leaseId);
  }
  if (event.source) {
    const existing = petInstances.get(event.source);
    if (existing) return existing;
    return createAutoInstance(event.source, event.source);
  }
  return getDefaultInstance();
}

function createAutoInstance(id: string, source: string): PetInstance {
  const instance = createPetInstance(id, source, defaultPet);
  petInstances.set(id, instance);
  if (petInstances.size === 2 && petInstances.has(DEFAULT_INSTANCE_ID)) {
    destroyForLease(DEFAULT_INSTANCE_ID);
  }
  void createWindowForInstance(instance);
  return instance;
}

function publishState() {
  publishAllStates();
}

function publishAllStates() {
  for (const instance of petInstances.values()) publishStateForInstance(instance);
  updateTrayMenu();
}

function publishStateForInstance(instance: PetInstance) {
  resizeWindowForCurrentScale(instance.window ?? undefined);
  instance.window?.webContents.send("pet-state", {
    state: instance.runtime.rendered,
    event: instance.runtime.event,
    activePet: instance.pet ? { ...instance.pet, spritesheetUrl: pathToFileURL(instance.pet.spritesheetPath).href } : null,
    scale: normalizeScale(config.scale),
    agentType: instance.agentType,
    detail: instance.detail,
  });
  updateTrayMenu();
}

async function handleSecondInstance(argv: string[]) {
  const action = await applyArgv(argv);
  if (hasOnboardingArg(argv)) {
    await openOnboardingWindow({ dirname: __dirname, debugMode, forced: true });
  }
  if (action !== "hide" && action !== "quit") {
    showPetWindow("second-instance");
  }
  publishState();
}

async function maybeOpenOnboardingWindow(argv: string[]) {
  const forced = hasOnboardingArg(argv);
  if (!shouldOpenOnboarding(config, { packaged: app.isPackaged, forced, mode: getOnboardingLaunchMode(argv) })) return;
  await openOnboardingWindow({ dirname: __dirname, debugMode, forced });
}

function getOnboardingLaunchMode(argv: string[]): "interactive" | "agent" {
  return argv.includes("--openpets-agent-launch") || process.env.OPENPETS_AGENT_LAUNCH === "1" ? "agent" : "interactive";
}

function hasOnboardingArg(argv: string[]) {
  return argv.includes("--openpets-onboarding") || argv.includes("--onboarding");
}

function getOnboardingSnapshot() {
  return {
    onboarding: config.onboarding ?? null,
    version: ONBOARDING_VERSION,
    packaged: app.isPackaged,
  };
}

async function markOnboardingSkipped() {
  config = { ...config, onboarding: createOnboardingState("skipped") };
  await saveConfig(config);
  return getOnboardingSnapshot();
}

async function markOnboardingCompleted() {
  config = { ...config, onboarding: createOnboardingState("completed") };
  await saveConfig(config);
  return getOnboardingSnapshot();
}

async function listStarterPets() {
  return [await getStarterPetSummary(STARTER_PET_ID)];
}

async function adoptStarterPet(petId: string) {
  if (petId !== STARTER_PET_ID) throw new Error("Unknown starter pet id.");
  const loaded = await loadCodexPetDirectory(getBundledDefaultPetPath());
  if (!loaded.ok) throw new Error(loaded.issues.map((item) => item.message).join("\n"));

  setDefaultPet(loaded.pet);
  const { petPath: _petPath, ...nextConfig } = config;
  config = { ...nextConfig, hidden: false, onboarding: createOnboardingState("completed") };
  await saveConfig(config);
  showPetWindow("starter-pet-adopted");
  publishState();

  return {
    ok: true,
    pet: await getStarterPetSummary(petId),
    message: `${loaded.pet.displayName || loaded.pet.id} is now your active pet.`,
    onboarding: getOnboardingSnapshot(),
  };
}

async function getStarterPetSummary(petId: string) {
  if (petId !== STARTER_PET_ID) throw new Error("Unknown starter pet id.");
  const loaded = await loadCodexPetDirectory(getBundledDefaultPetPath());
  return {
    id: STARTER_PET_ID,
    name: loaded.ok ? loaded.pet.displayName || loaded.pet.id : "Slayer",
    description: "The bundled starter pet included with OpenPets.",
    bundled: true,
  };
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
      setDefaultPet(loaded.pet);
      config = { ...config, petPath: loaded.pet.directory };
      await saveConfig(config);
    } else {
      console.error(loaded.issues.map((item) => item.message).join("\n"));
    }
  } else if (config.petPath) {
    const loaded = await loadCodexPetDirectory(config.petPath);
    if (loaded.ok) {
      setDefaultPet(loaded.pet);
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
      updateTrayMenu();
      break;
    case "hide":
      config = { ...config, hidden: true };
      await saveConfig(config);
      mainWindow?.hide();
      updateTrayMenu();
      break;
    case "sleep":
      applyEvent(createManualEvent("sleeping", { source: "desktop" }));
      break;
    case "quit":
      app.exit(0);
      break;
  }
}

async function choosePetDirectory() {
  const result = await dialog.showOpenDialog({
    title: "Choose OpenPets pet folder",
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return;

  const loaded = await loadCodexPetDirectory(result.filePaths[0]);
  if (!loaded.ok) {
    await dialog.showMessageBox({
      type: "error",
      title: "Invalid pet folder",
      message: "That folder is not a valid OpenPets/Codex pet.",
      detail: loaded.issues.map((item) => item.message).join("\n"),
    });
    return;
  }

  setDefaultPet(loaded.pet);
  config = { ...config, petPath: loaded.pet.directory };
  await saveConfig(config);
  installedPets = await loadInstalledPets();
  publishState();
}

async function selectPet(params: { path: string }) {
  const loaded = await loadCodexPetDirectory(resolve(params.path));
  if (!loaded.ok) {
    throw new Error(loaded.issues.map((item) => item.message).join("\n"));
  }

  setDefaultPet(loaded.pet);
  config = { ...config, petPath: loaded.pet.directory, hidden: false };
  await saveConfig(config);
  installedPets = await loadInstalledPets();

  // Update all existing instances that don't have a source-specific override
  for (const instance of petInstances.values()) {
    instance.pet = await resolvePetForSource(instance.leaseId);
  }

  showPetWindow("select-pet");
  publishState();
  return {
    pet: {
      id: loaded.pet.id,
      displayName: loaded.pet.displayName,
      directory: loaded.pet.directory,
    },
  };
}

async function selectInstalledPet(directory: string) {
  await selectPet({ path: directory }).catch(async (error: unknown) => {
    await dialog.showMessageBox({
      type: "error",
      title: "Could not switch pet",
      message: error instanceof Error ? error.message : "OpenPets could not load that pet.",
    });
  });
}

async function loadInstalledPets() {
  const petsDir = getOpenPetsPetsDir();
  const entries = await readdir(petsDir, { withFileTypes: true }).catch(() => []);
  const pets: LoadedCodexPet[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const loaded = await loadCodexPetDirectory(join(petsDir, entry.name));
    if (loaded.ok) pets.push(loaded.pet);
  }
  return pets.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

async function useDefaultPet() {
  const loaded = await loadCodexPetDirectory(getBundledDefaultPetPath());
  if (!loaded.ok) return;
  setDefaultPet(loaded.pet);
  const { petPath: _petPath, ...nextConfig } = config;
  config = nextConfig;
  await saveConfig(config);
  publishState();
}

async function setPetScale(scale: number) {
  config = { ...config, scale: normalizeScale(scale) };
  await saveConfig(config);
  resizeWindowForCurrentScale();
  publishState();
}

async function openConfigFile() {
  await mkdir(dirname(getOpenPetsConfigPath()), { recursive: true });
  await saveConfig(config);
  await reportShellOpenFailure("Open config file", shell.openPath(getOpenPetsConfigPath()));
}

async function revealConfigFolder() {
  const configDir = dirname(getOpenPetsConfigPath());
  await mkdir(configDir, { recursive: true });
  await reportShellOpenFailure("Reveal config folder", shell.openPath(configDir));
}

async function copyMcpConfig() {
  clipboard.writeText(GENERIC_MCP_CONFIG);
  await dialog.showMessageBox({
    type: "info",
    title: "MCP config copied",
    message: "Generic OpenPets MCP config was copied to the clipboard.",
    detail: GENERIC_MCP_CONFIG,
  });
}

async function openAllowlistedExternalUrl(title: string, url: string) {
  if (url !== INTEGRATIONS_DOCS_URL && url !== PET_GALLERY_URL) {
    await dialog.showMessageBox({
      type: "error",
      title,
      message: "OpenPets blocked an unknown external URL.",
    });
    return;
  }

  try {
    await shell.openExternal(url);
  } catch (error) {
    await dialog.showMessageBox({
      type: "error",
      title,
      message: "OpenPets could not open that link.",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function installCliCommand() {
  const result = await installCliShim({ homeDir: homedir() }).catch((error: unknown) => error instanceof Error ? error : new Error(String(error)));
  if (result instanceof Error) {
    await dialog.showMessageBox({
      type: "error",
      title: "Install CLI Command",
      message: "OpenPets could not install the CLI command.",
      detail: result.message,
    });
    return;
  }

  if ("code" in result) {
    const options: Electron.MessageBoxOptions = {
      type: "error",
      title: "Install CLI Command",
      message: result.message,
      ...(result.path ? { detail: `Path: ${result.path}` } : {}),
    };
    await dialog.showMessageBox({
      ...options,
    });
    return;
  }

  const pathGuidance = result.pathOnPath
    ? "This directory appears to be on PATH for the desktop process."
    : `Add ${dirname(result.path)} to your shell PATH if the openpets command is not found.`;
  const shadowGuidance = result.shadowedBy ? `\n\nAnother openpets command may appear earlier on PATH: ${result.shadowedBy}` : "";
  await dialog.showMessageBox({
    type: "info",
    title: "Install CLI Command",
    message: result.status === "already-installed" ? "The OpenPets CLI command is already installed." : result.status === "updated" ? "The OpenPets CLI command was updated." : "The OpenPets CLI command was installed.",
    detail: `Installed path: ${result.path}\n\n${pathGuidance}${shadowGuidance}\n\nTry: openpets start`,
  });
}

async function reportShellOpenFailure(title: string, operation: Promise<string>) {
  const error = await operation;
  if (!error) return;
  await dialog.showMessageBox({
    type: "error",
    title,
    message: "OpenPets could not open that path.",
    detail: error,
  });
}

function isWindowAction(action: unknown): action is "show" | "hide" | "sleep" | "quit" {
  return action === "show" || action === "hide" || action === "sleep" || action === "quit";
}

function handlePetInteraction(sender: WebContents, interaction: unknown) {
  const instance = getInstanceByWebContents(sender);
  const window = instance?.window;
  if (!window || !interaction || typeof interaction !== "object") return;
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
      window,
      startCursor: { x: screenX, y: screenY },
      startBounds: window.getBounds(),
    };
    return;
  }

  if (type === "drag-move" && dragState) {
    const nextX = Math.round(dragState.startBounds.x + screenX - dragState.startCursor.x);
    const nextY = Math.round(dragState.startBounds.y + screenY - dragState.startCursor.y);
    const currentBounds = dragState.window.getBounds();
    if (currentBounds.x === nextX && currentBounds.y === nextY) return;
    dragState.window.setPosition(nextX, nextY, false);
    return;
  }

  if (type === "drag-end") {
    const draggedWindow = dragState?.window;
    dragState = null;
    void saveWindowPosition(draggedWindow);
  }
}

async function saveWindowPosition(window = mainWindow) {
  if (dragState) return;
  const bounds = window?.getBounds();
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

function scheduleExpirationForInstance(instance: PetInstance) {
  if (instance.expirationTimer) {
    clearTimeout(instance.expirationTimer);
    instance.expirationTimer = null;
  }
  if (instance.runtime.temporaryUntil === null) return;
  const delay = Math.max(0, instance.runtime.temporaryUntil - Date.now());
  instance.expirationTimer = setTimeout(() => {
    instance.runtime = tickPetState(instance.runtime);
    publishStateForInstance(instance);
    scheduleExpirationForInstance(instance);
  }, delay + 5);
}

async function loadDefaultPet() {
  const loaded = await loadCodexPetDirectory(getBundledDefaultPetPath());
  if (loaded.ok) {
    activePet = loaded.pet;
    defaultPet = loaded.pet;
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

function resizeWindowForCurrentScale(window = mainWindow) {
  if (!window) return;
  const size = getWindowContentSize();
  const [currentWidth, currentHeight] = window.getContentSize();
  if (currentWidth === size.width && currentHeight === size.height) return;

  const oldBounds = window.getBounds();
  const anchorX = oldBounds.x + oldBounds.width;
  const anchorY = oldBounds.y + oldBounds.height;
  window.setContentSize(size.width, size.height, false);

  const newBounds = window.getBounds();
  const { workArea } = screen.getDisplayMatching(oldBounds);
  const nextX = clamp(anchorX - newBounds.width, workArea.x, workArea.x + workArea.width - newBounds.width);
  const nextY = clamp(anchorY - newBounds.height, workArea.y, workArea.y + workArea.height - newBounds.height);
  window.setPosition(nextX, nextY, false);
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
