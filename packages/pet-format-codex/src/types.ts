import type { CodexState } from "@openpets/core";

export type CodexPetManifest = {
  id?: string;
  displayName?: string;
  description?: string;
};

export type LoadedCodexPet = {
  directory: string;
  id: string;
  displayName: string;
  description: string;
  manifestPath: string;
  spritesheetPath: string;
  spritesheetFileName: "spritesheet.webp" | "spritesheet.png";
  states: readonly CodexState[];
};

export type PetValidationIssue = {
  code:
    | "not-directory"
    | "missing-manifest"
    | "invalid-manifest"
    | "missing-spritesheet"
    | "invalid-spritesheet"
    | "invalid-spritesheet-dimensions"
    | "invalid-path";
  message: string;
};

export type LoadCodexPetResult =
  | { ok: true; pet: LoadedCodexPet; warnings: PetValidationIssue[] }
  | { ok: false; issues: PetValidationIssue[] };
