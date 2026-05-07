import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";
import { onboardingIpcChannels } from "./channels.js";
import type { OnboardingIpcHandlers } from "./types.js";
import { isAssistantId } from "../assistant-setup/types.js";

let registered = false;
const allowedOnboardingWebContentsIds = new Set<number>();

export function allowOnboardingWebContents(webContents: WebContents) {
  allowedOnboardingWebContentsIds.add(webContents.id);
  webContents.once("destroyed", () => allowedOnboardingWebContentsIds.delete(webContents.id));
}

export function registerOnboardingIpc(handlers: OnboardingIpcHandlers) {
  if (registered) return;
  registered = true;

  ipcMain.handle(onboardingIpcChannels.getState, (event) => {
    assertAllowedOnboardingSender(event);
    return handlers.getState();
  });

  ipcMain.handle(onboardingIpcChannels.skip, async (event) => {
    assertAllowedOnboardingSender(event);
    return handlers.skip();
  });

  ipcMain.handle(onboardingIpcChannels.complete, async (event) => {
    assertAllowedOnboardingSender(event);
    return handlers.complete();
  });

  ipcMain.handle(onboardingIpcChannels.close, (event) => {
    assertAllowedOnboardingSender(event);
    handlers.close();
    return { ok: true };
  });

  ipcMain.handle(onboardingIpcChannels.detectAssistants, async (event) => {
    assertAllowedOnboardingSender(event);
    return handlers.detectAssistants();
  });

  ipcMain.handle(onboardingIpcChannels.previewAssistant, async (event, assistantId: unknown) => {
    assertAllowedOnboardingSender(event);
    if (!isAssistantId(assistantId)) throw new Error("Invalid assistant id.");
    return handlers.previewAssistant(assistantId);
  });

  ipcMain.handle(onboardingIpcChannels.applyAssistantSetup, async (event, previewToken: unknown) => {
    assertAllowedOnboardingSender(event);
    if (typeof previewToken !== "string" || previewToken.length > 200) throw new Error("Invalid preview token.");
    return handlers.applyAssistantSetup(previewToken);
  });

  ipcMain.handle(onboardingIpcChannels.testConnection, async (event) => {
    assertAllowedOnboardingSender(event);
    return handlers.testConnection();
  });

  ipcMain.handle(onboardingIpcChannels.listStarterPets, async (event) => {
    assertAllowedOnboardingSender(event);
    return handlers.listStarterPets();
  });

  ipcMain.handle(onboardingIpcChannels.adoptStarterPet, async (event, petId: unknown) => {
    assertAllowedOnboardingSender(event);
    if (typeof petId !== "string" || petId.length > 80) throw new Error("Invalid starter pet id.");
    return handlers.adoptStarterPet(petId);
  });
}

function assertAllowedOnboardingSender(event: IpcMainInvokeEvent) {
  if (!allowedOnboardingWebContentsIds.has(event.sender.id)) {
    throw new Error("Onboarding is not available from this window.");
  }
}
