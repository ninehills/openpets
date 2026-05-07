import { randomUUID } from "node:crypto";
import type { AssistantDetection, AssistantId, ConfigFileVersion, DetectionContext, SetupPlannedAction, SetupPreview } from "./types.js";
import { createPreviewToken } from "./tokens.js";
import { getConfigFileVersion, versionsMatch } from "./file-version.js";
import { getAssistantConfigTarget, type ConfigFormat } from "./paths.js";

type StoredPreview = {
  assistantId: AssistantId;
  targetPath: string | null;
  targetFormat: ConfigFormat;
  plannedAction: SetupPlannedAction;
  targetVersion: ConfigFileVersion | null;
  createdAt: number;
};

const previewStore = new Map<string, StoredPreview>();
const previewTtlMs = 10 * 60 * 1000;

export async function createSetupPreview(detection: AssistantDetection, context: DetectionContext): Promise<SetupPreview> {
  cleanupExpiredPreviews();
  const target = getAssistantConfigTarget(detection.id, context.platform, context.homeDir);
  const targetVersion = target.path ? await getConfigFileVersion(target.path) : null;
  const plannedAction = getPlannedAction(detection);
  const writeBlockedReason = getWriteBlockedReason(detection, targetVersion);
  const writeEligible = !writeBlockedReason && (plannedAction === "create" || plannedAction === "update");
  const token = createPreviewToken(detection.id, randomUUID());

  previewStore.set(token, {
    assistantId: detection.id,
    targetPath: target.path,
    targetFormat: target.format,
    plannedAction,
    targetVersion,
    createdAt: Date.now(),
  });

  return {
    token,
    assistantId: detection.id,
    assistantName: detection.name,
    configPath: detection.configPath,
    configFormat: detection.configFormat,
    plannedAction,
    targetVersion,
    summary: getPreviewSummary(detection, targetVersion),
    willWrite: writeEligible,
    writeEligible,
    writeBlockedReason,
    warnings: detection.warnings,
    similarServers: detection.similarServers,
  };
}

export async function validatePreviewForApply(token: string, assistantId: AssistantId, context: DetectionContext) {
  cleanupExpiredPreviews();
  const stored = previewStore.get(token);
  if (!stored) return { ok: false as const, message: "Setup preview expired or is invalid." };
  if (stored.assistantId !== assistantId) return { ok: false as const, message: "Setup preview does not match this assistant." };
  if (Date.now() - stored.createdAt > previewTtlMs) {
    previewStore.delete(token);
    return { ok: false as const, message: "Setup preview expired or is invalid." };
  }
  if (stored.targetPath) {
    const currentVersion = await getConfigFileVersion(stored.targetPath);
    if (!versionsMatch(stored.targetVersion, currentVersion)) {
      return { ok: false as const, message: "Config changed since preview. Refresh and review again." };
    }
    if (currentVersion.isSymlink || currentVersion.parentSymlink) return { ok: false as const, message: "Config path uses a symlink. Automatic setup is disabled for safety." };
    if (currentVersion.exists && !currentVersion.sha256) return { ok: false as const, message: "Config file cannot be safely versioned. Use manual setup." };
  }
  previewStore.delete(token);
  return { ok: true as const, stored };
}

function cleanupExpiredPreviews() {
  const now = Date.now();
  for (const [token, preview] of previewStore) {
    if (now - preview.createdAt > previewTtlMs) previewStore.delete(token);
  }
}

function getPlannedAction(detection: AssistantDetection): SetupPlannedAction {
  if (detection.configStatus === "configured") return "none";
  if (detection.configStatus === "missing" && detection.configPath) return "create";
  if (detection.configStatus === "configured-different") return "manual";
  return "manual";
}

function getWriteBlockedReason(detection: AssistantDetection, targetVersion: ConfigFileVersion | null) {
  if (detection.configFormat !== "json") return "Automatic writes are only planned for confirmed JSON configs in the next phase.";
  if (detection.configStatus === "configured") return "OpenPets is already configured.";
  if (detection.configStatus === "configured-different") return "An existing openpets MCP entry differs from the expected command. Manual review is required before replacing it.";
  if (detection.configStatus === "invalid") return "Config is invalid and must be fixed manually first.";
  if (detection.configStatus === "not-supported") return "This assistant/platform is not enabled for automatic writes.";
  if (targetVersion?.isSymlink || targetVersion?.parentSymlink) return "Target path uses a symlink.";
  if (targetVersion?.exists && !targetVersion.sha256) return "Existing config file cannot be safely versioned.";
  return null;
}

function getPreviewSummary(detection: AssistantDetection, targetVersion: ConfigFileVersion | null) {
  if (detection.configStatus === "configured") return "OpenPets is already configured for this assistant. No changes are needed.";
  if (detection.configStatus === "configured-different") return "An OpenPets entry exists but differs from the expected MCP command. Review manually before overwriting.";
  if (detection.configStatus === "invalid") return "The config file could not be parsed safely. Fix it manually or open the integration docs.";
  if (detection.configStatus === "not-supported") return "Automatic setup is not enabled for this assistant or platform yet. Use the integration docs for now.";
  if (targetVersion?.isSymlink || targetVersion?.parentSymlink) return "The target config path uses a symlink. Automatic writes are disabled for safety.";
  if (detection.configStatus === "missing" && detection.configPath && targetVersion?.exists) return "Apply will add the openpets MCP entry, preserve unrelated config keys, and create a backup before modifying the existing file.";
  if (detection.configStatus === "missing" && detection.configPath) return "Apply will create this config file and add the openpets MCP entry.";
  return "Review the detected assistant status. No changes will be made in this phase.";
}
