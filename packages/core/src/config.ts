import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type OpenPetsConfig = {
  petPath?: string;
  position?: { x: number; y: number };
  scale?: number;
  hidden?: boolean;
  onboarding?: OpenPetsOnboardingConfig;
};

export const ONBOARDING_VERSION = 1;

export type OpenPetsOnboardingStatus = "not-started" | "skipped" | "completed";

export type OpenPetsOnboardingConfig = {
  status: OpenPetsOnboardingStatus;
  version: number;
  completedAt?: string;
  skippedAt?: string;
};

export type OnboardingLaunchMode = "interactive" | "agent";

export type ShouldOpenOnboardingOptions = {
  packaged: boolean;
  forced?: boolean;
  mode?: OnboardingLaunchMode;
  currentVersion?: number;
};

export function shouldOpenOnboarding(config: OpenPetsConfig, options: ShouldOpenOnboardingOptions) {
  if (options.forced) return true;
  if (!options.packaged) return false;
  if (options.mode === "agent") return false;

  const currentVersion = options.currentVersion ?? ONBOARDING_VERSION;
  const onboarding = config.onboarding;
  if (!onboarding) return true;
  if (onboarding.status === "not-started") return true;
  if (onboarding.status === "completed" && onboarding.version < currentVersion) return true;
  return false;
}

export function createOnboardingState(status: OpenPetsOnboardingStatus, now = new Date()): OpenPetsOnboardingConfig {
  const timestamp = now.toISOString();
  return {
    status,
    version: ONBOARDING_VERSION,
    ...(status === "completed" ? { completedAt: timestamp } : {}),
    ...(status === "skipped" ? { skippedAt: timestamp } : {}),
  };
}

export const CONFIG_FILE_NAME = "config.json";

export function getOpenPetsConfigDir(env: NodeJS.ProcessEnv = process.env) {
  if (env.OPENPETS_CONFIG_DIR) {
    return resolve(env.OPENPETS_CONFIG_DIR);
  }

  switch (process.platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", "OpenPets");
    case "win32":
      return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "OpenPets");
    default:
      return join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "openpets");
  }
}

export function getOpenPetsConfigPath(env: NodeJS.ProcessEnv = process.env) {
  return join(getOpenPetsConfigDir(env), CONFIG_FILE_NAME);
}

export function getOpenPetsPetsDir(env: NodeJS.ProcessEnv = process.env) {
  return join(getOpenPetsConfigDir(env), "pets");
}
