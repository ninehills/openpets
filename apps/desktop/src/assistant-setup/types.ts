export const assistantIds = ["claude-code", "opencode", "cursor", "vscode", "windsurf", "zed"] as const;

export type AssistantId = (typeof assistantIds)[number];

export type AssistantInstallStatus = "installed" | "not-found" | "unknown";
export type AssistantConfigStatus = "missing" | "configured" | "configured-different" | "invalid" | "not-supported";
export type BunxStatus = "found" | "not-found" | "unknown";
export type SetupWarningCode = "similar-server-found" | "bunx-unavailable" | "path-unconfirmed" | "manual-review-required";

export type SetupWarning = {
  code: SetupWarningCode;
  message: string;
};

export type SafeServerSummary = {
  name: string;
  reason: string;
};

export type AssistantDetection = {
  id: AssistantId;
  name: string;
  installStatus: AssistantInstallStatus;
  configStatus: AssistantConfigStatus;
  configPath: string | null;
  configFormat: "json" | "jsonc" | "cli" | null;
  bunxStatus: BunxStatus;
  docsUrl: string;
  warnings: SetupWarning[];
  similarServers: SafeServerSummary[];
};

export type SetupPreview = {
  token: string;
  assistantId: AssistantId;
  assistantName: string;
  configPath: string | null;
  configFormat: "json" | "jsonc" | "cli" | null;
  plannedAction: SetupPlannedAction;
  targetVersion: ConfigFileVersion | null;
  summary: string;
  willWrite: boolean;
  writeEligible: boolean;
  writeBlockedReason: string | null;
  warnings: SetupWarning[];
  similarServers: SafeServerSummary[];
};

export type SetupPlannedAction = "none" | "create" | "update" | "manual";

export type ConfigFileVersion = {
  exists: boolean;
  isSymlink: boolean;
  parentSymlink: boolean;
  size: number | null;
  mtimeMs: number | null;
  sha256: string | null;
};

export type SetupResult = {
  assistantId: AssistantId;
  ok: boolean;
  message: string;
  detection?: AssistantDetection;
};

export type DetectionContext = {
  platform: NodeJS.Platform;
  homeDir: string;
  env: NodeJS.ProcessEnv;
};

export type ApplyOptions = {
  previewToken: string;
};

export type AssistantSetupAdapter = {
  id: AssistantId;
  name: string;
  docsUrl: string;
  detect(context: DetectionContext): Promise<AssistantDetection>;
  preview(context: DetectionContext): Promise<SetupPreview>;
  apply(context: DetectionContext, options: ApplyOptions): Promise<SetupResult>;
};

export function isAssistantId(value: unknown): value is AssistantId {
  return typeof value === "string" && (assistantIds as readonly string[]).includes(value);
}
