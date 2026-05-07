export const onboardingIpcChannels = {
  getState: "onboarding:get-state",
  skip: "onboarding:skip",
  complete: "onboarding:complete",
  close: "onboarding:close",
  detectAssistants: "onboarding:detect-assistants",
  previewAssistant: "onboarding:preview-assistant",
  applyAssistantSetup: "onboarding:apply-assistant-setup",
  testConnection: "onboarding:test-connection",
  listStarterPets: "onboarding:list-starter-pets",
  adoptStarterPet: "onboarding:adopt-starter-pet",
} as const;
