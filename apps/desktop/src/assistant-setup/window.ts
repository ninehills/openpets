import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow } from "electron";
import { allowAssistantSetupWebContents } from "./ipc.js";

let assistantSetupWindow: BrowserWindow | null = null;

export async function openAssistantSetupWindow(options: { dirname: string; debugMode: boolean }) {
  if (assistantSetupWindow && !assistantSetupWindow.isDestroyed()) {
    assistantSetupWindow.show();
    assistantSetupWindow.focus();
    return assistantSetupWindow;
  }

  assistantSetupWindow = new BrowserWindow({
    width: 760,
    height: 560,
    minWidth: 640,
    minHeight: 460,
    title: "Setup AI Assistants - OpenPets",
    backgroundColor: "#0f172a",
    show: false,
    webPreferences: {
      preload: join(options.dirname, "assistant-setup-preload.cjs"),
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

  allowAssistantSetupWebContents(assistantSetupWindow.webContents);
  hardenAssistantSetupWindowNavigation(assistantSetupWindow, options.dirname);
  assistantSetupWindow.once("ready-to-show", () => assistantSetupWindow?.show());
  assistantSetupWindow.on("closed", () => {
    assistantSetupWindow = null;
  });

  if (app.isPackaged) {
    await assistantSetupWindow.loadFile(join(options.dirname, "renderer", "index.html"), { query: { view: "assistant-setup" } });
  } else {
    await assistantSetupWindow.loadURL("http://127.0.0.1:5173/?view=assistant-setup");
  }

  if (options.debugMode) assistantSetupWindow.webContents.openDevTools({ mode: "detach" });
  return assistantSetupWindow;
}

function hardenAssistantSetupWindowNavigation(window: BrowserWindow, dirname: string) {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedAssistantSetupNavigation(url, dirname)) {
      event.preventDefault();
    }
  });
}

function isAllowedAssistantSetupNavigation(url: string, dirname: string) {
  return url === "http://127.0.0.1:5173/?view=assistant-setup" || url.startsWith(pathToFileURL(join(dirname, "renderer")).href);
}
