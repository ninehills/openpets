import type { OpenPetsOnboardingConfig } from "@open-pets/core/config";
import type { AssistantDetection, AssistantId, SetupPreview, SetupResult } from "../assistant-setup/types.js";

export type OnboardingSnapshot = {
  onboarding: OpenPetsOnboardingConfig | null;
  version: number;
  packaged: boolean;
};

export type OnboardingIpcHandlers = {
  getState(): OnboardingSnapshot;
  skip(): Promise<OnboardingSnapshot>;
  complete(): Promise<OnboardingSnapshot>;
  close(): void;
  detectAssistants(): Promise<AssistantDetection[]>;
  previewAssistant(assistantId: AssistantId): Promise<SetupPreview>;
  applyAssistantSetup(previewToken: string): Promise<SetupResult>;
  testConnection(): Promise<OnboardingConnectionTestResult>;
  listStarterPets(): Promise<StarterPetSummary[]>;
  adoptStarterPet(petId: string): Promise<StarterPetAdoptionResult>;
};

export type OnboardingConnectionTestResult = {
  ok: boolean;
  message: string;
  checklist: Array<{ label: string; ok: boolean; detail: string }>;
};

export type StarterPetSummary = {
  id: string;
  name: string;
  description: string;
  bundled: boolean;
};

export type StarterPetAdoptionResult = {
  ok: boolean;
  pet: StarterPetSummary;
  message: string;
  onboarding: OnboardingSnapshot;
};
