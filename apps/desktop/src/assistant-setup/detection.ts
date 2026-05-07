import type { AssistantConfigStatus, AssistantDetection, AssistantId, BunxStatus, DetectionContext, SafeServerSummary, SetupWarning } from "./types.js";
import { detectBunxStatus, hasAssistantExecutable } from "./executables.js";
import { asRecord, getRecordProperty, readConfigFile } from "./config-json.js";
import { getAssistantConfigTarget, type AssistantConfigTarget } from "./paths.js";

const executableNames: Record<AssistantId, readonly string[]> = {
  "claude-code": ["claude"],
  opencode: ["opencode"],
  cursor: ["cursor"],
  vscode: ["code"],
  windsurf: ["windsurf"],
  zed: ["zed"],
};

const serverCollectionKeys: Partial<Record<AssistantId, string>> = {
  cursor: "mcpServers",
  windsurf: "mcpServers",
  vscode: "servers",
  zed: "context_servers",
  opencode: "mcp",
};

export async function detectAssistantSetup(
  assistant: { id: AssistantId; name: string; docsUrl: string },
  context: DetectionContext,
): Promise<AssistantDetection> {
  const [bunxStatus, executableFound] = await Promise.all([
    detectBunxStatus(context),
    hasAssistantExecutable(context, executableNames[assistant.id]),
  ]);
  const target = getAssistantConfigTarget(assistant.id, context.platform, context.homeDir);
  const warnings: SetupWarning[] = [];
  if (bunxStatus !== "found") warnings.push({ code: "bunx-unavailable", message: "bunx was not found in the app environment; MCP startup may require manual PATH setup." });
  if (!target.confirmed) warnings.push({ code: "path-unconfirmed", message: target.notes });

  const configResult = await detectConfigStatus(assistant.id, target);
  warnings.push(...configResult.warnings);

  return {
    id: assistant.id,
    name: assistant.name,
    installStatus: executableFound || configResult.configExists ? "installed" : "unknown",
    configStatus: configResult.status,
    configPath: target.path,
    configFormat: target.format,
    bunxStatus,
    docsUrl: assistant.docsUrl,
    warnings,
    similarServers: configResult.similarServers,
  };
}

async function detectConfigStatus(assistantId: AssistantId, target: AssistantConfigTarget): Promise<{ status: AssistantConfigStatus; configExists: boolean; warnings: SetupWarning[]; similarServers: SafeServerSummary[] }> {
  if (!target.path || target.format === "cli" || !target.confirmed) {
    return { status: "not-supported", configExists: false, warnings: [], similarServers: [] };
  }

  const parsed = await readConfigFile(target.path, target.format);
  if (!parsed) return { status: "missing", configExists: false, warnings: [], similarServers: [] };
  if (!parsed.ok) return { status: "invalid", configExists: true, warnings: [{ code: "manual-review-required", message: parsed.error }], similarServers: [] };

  const root = asRecord(parsed.value);
  if (!root) return { status: "invalid", configExists: true, warnings: [{ code: "manual-review-required", message: "Config root must be a JSON object." }], similarServers: [] };

  const collectionKey = serverCollectionKeys[assistantId];
  if (collectionKey && collectionKey in root && !asRecord(root[collectionKey])) {
    return { status: "invalid", configExists: true, warnings: [{ code: "manual-review-required", message: `${collectionKey} must be a JSON object.` }], similarServers: [] };
  }

  const servers = getServerCollection(assistantId, root);
  const openPetsServer = asRecord(servers?.openpets);
  const similarServers = findSimilarServers(servers);
  const warnings = similarServers.length > 0 ? [{ code: "similar-server-found" as const, message: "Another OpenPets-like MCP server is already configured." }] : [];

  if (!openPetsServer) return { status: "missing", configExists: true, warnings, similarServers };
  return {
    status: isExpectedOpenPetsServer(assistantId, openPetsServer) ? "configured" : "configured-different",
    configExists: true,
    warnings,
    similarServers,
  };
}

function getServerCollection(assistantId: AssistantId, config: unknown) {
  const key = serverCollectionKeys[assistantId];
  return key ? getRecordProperty(config, key) : null;
}

function isExpectedOpenPetsServer(assistantId: AssistantId, server: Record<string, unknown>) {
  if (assistantId === "opencode") {
    return server.type === "local" && Array.isArray(server.command) && server.command[0] === "bunx" && server.command[1] === "@open-pets/mcp" && server.enabled === true;
  }
  return server.command === "bunx" && Array.isArray(server.args) && server.args[0] === "@open-pets/mcp";
}

function findSimilarServers(servers: Record<string, unknown> | null): SafeServerSummary[] {
  if (!servers) return [];
  const matches: SafeServerSummary[] = [];
  for (const [name, value] of Object.entries(servers)) {
    if (name === "openpets") continue;
    const safeText = JSON.stringify(value);
    if (!safeText) continue;
    if (/@open-pets\/mcp|openpets-mcp|opencode-pets|claude-pets/i.test(safeText) || /openpets/i.test(name)) {
      matches.push({ name: sanitizeServerName(name), reason: "OpenPets-like MCP command or server name" });
    }
  }
  return matches;
}

function sanitizeServerName(name: string) {
  return name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 80) || "unnamed";
}
