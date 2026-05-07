import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow } from "electron";
import { allowOnboardingWebContents } from "./ipc.js";

let onboardingWindow: BrowserWindow | null = null;

export async function openOnboardingWindow(options: { dirname: string; debugMode: boolean; forced?: boolean }) {
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.show();
    onboardingWindow.focus();
    return onboardingWindow;
  }

  onboardingWindow = new BrowserWindow({
    width: 860,
    height: 640,
    minWidth: 720,
    minHeight: 520,
    title: "Welcome to OpenPets",
    backgroundColor: "#0f172a",
    show: false,
    webPreferences: {
      preload: join(options.dirname, "onboarding-preload.cjs"),
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

  allowOnboardingWebContents(onboardingWindow.webContents);
  hardenOnboardingWindowNavigation(onboardingWindow, options.dirname);
  onboardingWindow.once("ready-to-show", () => onboardingWindow?.show());
  onboardingWindow.on("closed", () => {
    onboardingWindow = null;
  });

  const query = options.forced ? { view: "onboarding", forced: "1" } : { view: "onboarding" };
  if (app.isPackaged) {
    await onboardingWindow.loadFile(join(options.dirname, "renderer", "index.html"), { query });
  } else {
    const forced = options.forced ? "&forced=1" : "";
    await onboardingWindow.loadURL(`http://127.0.0.1:5173/?view=onboarding${forced}`);
  }

  if (options.debugMode) onboardingWindow.webContents.openDevTools({ mode: "detach" });
  return onboardingWindow;
}

export function closeOnboardingWindow() {
  onboardingWindow?.close();
}

function hardenOnboardingWindowNavigation(window: BrowserWindow, dirname: string) {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedOnboardingNavigation(url, dirname)) {
      event.preventDefault();
    }
  });
}

function isAllowedOnboardingNavigation(url: string, dirname: string) {
  return url.startsWith("http://127.0.0.1:5173/?view=onboarding") || url.startsWith(pathToFileURL(join(dirname, "renderer")).href);
}
