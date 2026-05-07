import { contextBridge, ipcRenderer } from "electron";
import type { AssistantDetection, AssistantId, SetupPreview, SetupResult } from "./types.js";
import { assistantIds } from "./types.js";
import { assistantSetupIpcChannels } from "./channels.js";

const assistantIdSet = new Set<string>(assistantIds);

const api = {
  detect(): Promise<AssistantDetection[]> {
    return ipcRenderer.invoke(assistantSetupIpcChannels.detect);
  },
  preview(assistantId: AssistantId): Promise<SetupPreview> {
    if (!assistantIdSet.has(assistantId)) return Promise.reject(new Error("Invalid assistant id."));
    return ipcRenderer.invoke(assistantSetupIpcChannels.preview, assistantId);
  },
  apply(previewToken: string): Promise<SetupResult> {
    if (typeof previewToken !== "string" || previewToken.length > 200) return Promise.reject(new Error("Invalid preview token."));
    return ipcRenderer.invoke(assistantSetupIpcChannels.apply, previewToken);
  },
  openDocs(assistantId: AssistantId): Promise<{ ok: boolean }> {
    if (!assistantIdSet.has(assistantId)) return Promise.reject(new Error("Invalid assistant id."));
    return ipcRenderer.invoke(assistantSetupIpcChannels.openDocs, assistantId);
  },
};

contextBridge.exposeInMainWorld("openPetsAssistantSetup", api);

declare global {
  interface Window {
    openPetsAssistantSetup: typeof api;
  }
}
