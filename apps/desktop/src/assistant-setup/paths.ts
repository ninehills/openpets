import { join } from "node:path";
import type { AssistantId } from "./types.js";

export type ConfigFormat = "json" | "jsonc" | "cli";

export type AssistantConfigTarget = {
  assistantId: AssistantId;
  platform: NodeJS.Platform | "all";
  scope: "user" | "cli";
  path: string | null;
  format: ConfigFormat;
  confirmed: boolean;
  notes: string;
};

export function getAssistantConfigTarget(assistantId: AssistantId, platform: NodeJS.Platform, homeDir: string): AssistantConfigTarget {
  switch (assistantId) {
    case "claude-code":
      return cliTarget(assistantId, platform, "Claude Code setup should prefer the `claude mcp add` command when confirmed available.");
    case "opencode":
      return {
        assistantId,
        platform,
        scope: "user",
        path: null,
        format: "jsonc",
        confirmed: false,
        notes: "OpenCode global/project config semantics need confirmation before auto-write.",
      };
    case "cursor":
      return jsonTarget(assistantId, platform, join(homeDir, ".cursor", "mcp.json"), true, "Cursor user MCP config path from OpenPets docs.");
    case "vscode":
      return {
        assistantId,
        platform,
        scope: "user",
        path: null,
        format: "jsonc",
        confirmed: false,
        notes: "VS Code user-level MCP path/CLI behavior needs confirmation before auto-write.",
      };
    case "windsurf":
      return jsonTarget(assistantId, platform, join(homeDir, ".codeium", "windsurf", "mcp_config.json"), true, "Windsurf user MCP config path from OpenPets docs.");
    case "zed":
      return {
        assistantId,
        platform,
        scope: "user",
        path: platform === "win32" ? null : join(homeDir, ".config", "zed", "settings.json"),
        format: "jsonc",
        confirmed: platform !== "win32",
        notes: platform === "win32" ? "Zed Windows config support needs confirmation." : "Zed settings path from OpenPets docs; JSONC write support required before auto-write.",
      };
  }
}

function jsonTarget(assistantId: AssistantId, platform: NodeJS.Platform, path: string, confirmed: boolean, notes: string): AssistantConfigTarget {
  return { assistantId, platform, scope: "user", path, format: "json", confirmed, notes };
}

function cliTarget(assistantId: AssistantId, platform: NodeJS.Platform, notes: string): AssistantConfigTarget {
  return { assistantId, platform, scope: "cli", path: null, format: "cli", confirmed: false, notes };
}
