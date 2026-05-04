import { contextBridge, ipcRenderer } from "electron";
import type { OpenPetsEvent, OpenPetsState } from "@openpets/core";
import type { LoadedCodexPet } from "@openpets/pet-format-codex";

export type RendererPetState = {
  state: OpenPetsState;
  event?: OpenPetsEvent;
  activePet: (LoadedCodexPet & { spritesheetUrl: string }) | null;
  scale?: number;
};

const api = {
  onPetState(callback: (state: RendererPetState) => void) {
    const listener = (_event: unknown, state: RendererPetState) => callback(state);
    ipcRenderer.on("pet-state", listener);
    return () => {
      ipcRenderer.removeListener("pet-state", listener);
    };
  },
  ready() {
    ipcRenderer.send("renderer-ready");
  },
  windowAction(action: unknown) {
    if (action === "show" || action === "hide" || action === "sleep" || action === "quit") {
      ipcRenderer.send("window-action", action);
    }
  },
};

contextBridge.exposeInMainWorld("openPets", api);

declare global {
  interface Window {
    openPets: typeof api;
  }
}
