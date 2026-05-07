import { contextBridge, ipcRenderer } from "electron";
import { onboardingIpcChannels } from "./channels.js";
import type { OnboardingConnectionTestResult, OnboardingSnapshot, StarterPetAdoptionResult, StarterPetSummary } from "./types.js";
import type { AssistantDetection, AssistantId, SetupPreview, SetupResult } from "../assistant-setup/types.js";
import { assistantIds } from "../assistant-setup/types.js";

const assistantIdSet = new Set<string>(assistantIds);

const api = {
  getState(): Promise<OnboardingSnapshot> {
    return ipcRenderer.invoke(onboardingIpcChannels.getState);
  },
  skip(): Promise<OnboardingSnapshot> {
    return ipcRenderer.invoke(onboardingIpcChannels.skip);
  },
  complete(): Promise<OnboardingSnapshot> {
    return ipcRenderer.invoke(onboardingIpcChannels.complete);
  },
  close(): Promise<{ ok: boolean }> {
    return ipcRenderer.invoke(onboardingIpcChannels.close);
  },
  detectAssistants(): Promise<AssistantDetection[]> {
    return ipcRenderer.invoke(onboardingIpcChannels.detectAssistants);
  },
  previewAssistant(assistantId: AssistantId): Promise<SetupPreview> {
    if (!assistantIdSet.has(assistantId)) return Promise.reject(new Error("Invalid assistant id."));
    return ipcRenderer.invoke(onboardingIpcChannels.previewAssistant, assistantId);
  },
  applyAssistantSetup(previewToken: string): Promise<SetupResult> {
    if (typeof previewToken !== "string" || previewToken.length > 200) return Promise.reject(new Error("Invalid preview token."));
    return ipcRenderer.invoke(onboardingIpcChannels.applyAssistantSetup, previewToken);
  },
  testConnection(): Promise<OnboardingConnectionTestResult> {
    return ipcRenderer.invoke(onboardingIpcChannels.testConnection);
  },
  listStarterPets(): Promise<StarterPetSummary[]> {
    return ipcRenderer.invoke(onboardingIpcChannels.listStarterPets);
  },
  adoptStarterPet(petId: string): Promise<StarterPetAdoptionResult> {
    if (typeof petId !== "string" || petId.length > 80) return Promise.reject(new Error("Invalid starter pet id."));
    return ipcRenderer.invoke(onboardingIpcChannels.adoptStarterPet, petId);
  },
};

contextBridge.exposeInMainWorld("openPetsOnboarding", api);

declare global {
  interface Window {
    openPetsOnboarding: typeof api;
  }
}
