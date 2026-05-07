import { homedir } from "node:os";
import type {
  ApplyOptions,
  AssistantDetection,
  AssistantId,
  AssistantSetupAdapter,
  DetectionContext,
  SetupPreview,
  SetupResult,
} from "./types.js";
import { assistantIds } from "./types.js";
import { detectAssistantSetup } from "./detection.js";
import { createSetupPreview, validatePreviewForApply } from "./preview.js";
import { applyJsonMcpConfig } from "./config-write.js";

const integrationBaseUrl = "https://openpets.dev/integrations";

const assistantMetadata: Record<AssistantId, { name: string; docsUrl: string }> = {
  "claude-code": { name: "Claude Code", docsUrl: `${integrationBaseUrl}/claude-code` },
  opencode: { name: "OpenCode", docsUrl: `${integrationBaseUrl}/opencode` },
  cursor: { name: "Cursor", docsUrl: `${integrationBaseUrl}/cursor` },
  vscode: { name: "VS Code / GitHub Copilot", docsUrl: `${integrationBaseUrl}/vscode` },
  windsurf: { name: "Windsurf", docsUrl: `${integrationBaseUrl}/windsurf` },
  zed: { name: "Zed", docsUrl: `${integrationBaseUrl}/zed` },
};

export const assistantSetupAdapters: readonly AssistantSetupAdapter[] = assistantIds.map((id) => createStubAdapter(id));

const adapterById = new Map<AssistantId, AssistantSetupAdapter>(assistantSetupAdapters.map((adapter) => [adapter.id, adapter]));

export function getAssistantSetupAdapter(id: AssistantId) {
  const adapter = adapterById.get(id);
  if (!adapter) throw new Error(`Unknown assistant setup adapter: ${id}`);
  return adapter;
}

export function createDetectionContext(env: NodeJS.ProcessEnv = process.env): DetectionContext {
  return {
    platform: process.platform,
    homeDir: homedir(),
    env,
  };
}

export async function detectAssistantSetups(context: DetectionContext = createDetectionContext()): Promise<AssistantDetection[]> {
  return Promise.all(assistantSetupAdapters.map((adapter) => adapter.detect(context)));
}

export function getAssistantDocsUrl(id: AssistantId) {
  return assistantMetadata[id].docsUrl;
}

export function getAllowedAssistantDocsUrls() {
  return new Set(Object.values(assistantMetadata).map((metadata) => metadata.docsUrl));
}

function createStubAdapter(id: AssistantId): AssistantSetupAdapter {
  const metadata = assistantMetadata[id];
  return {
    id,
    name: metadata.name,
    docsUrl: metadata.docsUrl,
    async detect(context: DetectionContext): Promise<AssistantDetection> {
      return detectAssistantSetup({ id, name: metadata.name, docsUrl: metadata.docsUrl }, context);
    },
    async preview(context: DetectionContext): Promise<SetupPreview> {
      return createSetupPreview(await detectAssistantSetup({ id, name: metadata.name, docsUrl: metadata.docsUrl }, context), context);
    },
    async apply(_context: DetectionContext, _options: ApplyOptions): Promise<SetupResult> {
      const validation = await validatePreviewForApply(_options.previewToken, id, _context);
      if (!validation.ok) {
        return {
          assistantId: id,
          ok: false,
          message: validation.message,
        };
      }
      const stored = validation.stored;
      if (stored.targetFormat !== "json" || (stored.plannedAction !== "create" && stored.plannedAction !== "update") || !stored.targetPath) {
        return {
          assistantId: id,
          ok: false,
          message: "Automatic setup is not enabled for this preview.",
        };
      }
      const writeResult = await applyJsonMcpConfig(id, stored.targetPath);
      const detection = await detectAssistantSetup({ id, name: metadata.name, docsUrl: metadata.docsUrl }, _context);
      return {
        assistantId: id,
        ok: detection.configStatus === "configured",
        message: writeResult.backupPath ? `OpenPets MCP config updated. Backup created at ${writeResult.backupPath}.` : "OpenPets MCP config created.",
        detection,
      };
    },
  };
}
