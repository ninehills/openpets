import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { assistantSetupIpcChannels } from "./channels.js";
import { createPreviewToken, parsePreviewToken } from "./tokens.js";
import { assistantIds, type DetectionContext } from "./types.js";
import { isAssistantId } from "./types.js";
import { assistantSetupAdapters, detectAssistantSetups, getAllowedAssistantDocsUrls, getAssistantDocsUrl } from "./registry.js";
import { getAssistantConfigTarget } from "./paths.js";

describe("assistant setup registry", () => {
  test("includes one adapter for every supported assistant", () => {
    expect(assistantSetupAdapters.map((adapter) => adapter.id).sort()).toEqual([...assistantIds].sort());
  });

  test("uses allowlisted OpenPets integration URLs", () => {
    const allowedUrls = getAllowedAssistantDocsUrls();
    for (const assistantId of assistantIds) {
      const docsUrl = getAssistantDocsUrl(assistantId);
      expect(docsUrl.startsWith("https://openpets.dev/integrations/")).toBe(true);
      expect(allowedUrls.has(docsUrl)).toBe(true);
    }
  });

  test("validates assistant ids", () => {
    for (const assistantId of assistantIds) {
      expect(isAssistantId(assistantId)).toBe(true);
    }
    expect(isAssistantId("not-real")).toBe(false);
    expect(isAssistantId(null)).toBe(false);
  });

  test("IPC channel names are unique and namespaced", () => {
    const channels = Object.values(assistantSetupIpcChannels);
    expect(new Set(channels).size).toBe(channels.length);
    for (const channel of channels) {
      expect(channel.startsWith("assistant-setup:")).toBe(true);
    }
  });

  test("preview tokens encode only supported assistant ids", () => {
    for (const assistantId of assistantIds) {
      const token = createPreviewToken(assistantId);
      expect(parsePreviewToken(token)).toEqual({ assistantId, nonce: "not-supported", token });
    }
    expect(parsePreviewToken("preview:not-real:not-supported")).toBeNull();
    expect(parsePreviewToken("not-preview:cursor:not-supported")).toBeNull();
    expect(parsePreviewToken("preview:cursor")).toBeNull();
    expect(parsePreviewToken("preview:cursor:nonce:extra")).toBeNull();
    expect(parsePreviewToken("x".repeat(201))).toBeNull();
  });

  test("returns conservative detections when config paths are missing", async () => {
    const detections = await detectAssistantSetups({ platform: "linux", homeDir: "/tmp/openpets-test", env: {} });
    expect(detections).toHaveLength(assistantIds.length);
    for (const detection of detections) {
      expect(assistantIds).toContain(detection.id);
      expect(detection.installStatus).toBe("unknown");
      expect(detection.bunxStatus).toBe("unknown");
      expect(detection.similarServers).toEqual([]);
    }
  });

  test("defines confirmed user config paths for low-risk JSON assistants", () => {
    const homeDir = "/Users/example";
    expect(getAssistantConfigTarget("cursor", "darwin", homeDir)).toMatchObject({ path: join(homeDir, ".cursor", "mcp.json"), format: "json", confirmed: true });
    expect(getAssistantConfigTarget("windsurf", "linux", homeDir)).toMatchObject({ path: join(homeDir, ".codeium", "windsurf", "mcp_config.json"), format: "json", confirmed: true });
    expect(getAssistantConfigTarget("zed", "win32", homeDir)).toMatchObject({ path: null, confirmed: false });
    expect(getAssistantConfigTarget("vscode", "linux", homeDir)).toMatchObject({ path: null, confirmed: false });
  });

  test("detects configured Cursor MCP config without exposing full config", async () => {
    const homeDir = await makeTempHome();
    await writeJson(join(homeDir, ".cursor", "mcp.json"), {
      mcpServers: {
        openpets: { type: "stdio", command: "bunx", args: ["@open-pets/mcp"] },
        other: { command: "bunx", args: ["@open-pets/mcp"] },
      },
      unrelated: { privateValue: "do-not-return" },
    });

    const cursor = (await detectAssistantSetups(context(homeDir))).find((item) => item.id === "cursor");
    expect(cursor).toMatchObject({ id: "cursor", installStatus: "installed", configStatus: "configured", configPath: join(homeDir, ".cursor", "mcp.json"), configFormat: "json" });
    expect(cursor?.similarServers).toEqual([{ name: "other", reason: "OpenPets-like MCP command or server name" }]);
    expect(JSON.stringify(cursor)).not.toContain("do-not-return");
  });

  test("detects configured-different and invalid config states", async () => {
    const differentHome = await makeTempHome();
    await writeJson(join(differentHome, ".codeium", "windsurf", "mcp_config.json"), {
      mcpServers: { openpets: { command: "node", args: ["openpets-mcp"] } },
    });
    const windsurf = (await detectAssistantSetups(context(differentHome))).find((item) => item.id === "windsurf");
    expect(windsurf?.configStatus).toBe("configured-different");

    const invalidHome = await makeTempHome();
    await mkdir(join(invalidHome, ".cursor"), { recursive: true });
    await writeFile(join(invalidHome, ".cursor", "mcp.json"), "{ nope", "utf8");
    const cursor = (await detectAssistantSetups(context(invalidHome))).find((item) => item.id === "cursor");
    expect(cursor?.configStatus).toBe("invalid");
    expect(cursor?.warnings.some((warning) => warning.code === "manual-review-required")).toBe(true);
  });

  test("treats malformed JSON shapes as invalid before writes", async () => {
    const arrayHome = await makeTempHome();
    await mkdir(join(arrayHome, ".cursor"), { recursive: true });
    await writeFile(join(arrayHome, ".cursor", "mcp.json"), "[]", "utf8");
    const arrayCursor = (await detectAssistantSetups(context(arrayHome))).find((item) => item.id === "cursor");
    expect(arrayCursor?.configStatus).toBe("invalid");

    const nonObjectHome = await makeTempHome();
    await writeJson(join(nonObjectHome, ".cursor", "mcp.json"), { mcpServers: [] });
    const nonObjectCursor = (await detectAssistantSetups(context(nonObjectHome))).find((item) => item.id === "cursor");
    expect(nonObjectCursor?.configStatus).toBe("invalid");
  });

  test("detects bunx availability from PATH conservatively", async () => {
    const homeDir = await makeTempHome();
    const binDir = join(homeDir, "bin");
    await mkdir(binDir, { recursive: true });
    await writeFile(join(binDir, "bunx"), "#!/bin/sh\n", "utf8");
    const detections = await detectAssistantSetups(context(homeDir, { PATH: binDir }));
    expect(detections.every((item) => item.bunxStatus === "found")).toBe(true);
  });

  test("creates safe previews with file version and similar-server summaries", async () => {
    const homeDir = await makeTempHome();
    const configPath = join(homeDir, ".cursor", "mcp.json");
    await writeJson(configPath, {
      mcpServers: {
        openpets: { type: "stdio", command: "bunx", args: ["@open-pets/mcp"] },
        other: { command: "bunx", args: ["@open-pets/mcp"] },
      },
    });

    const cursorAdapter = assistantSetupAdapters.find((adapter) => adapter.id === "cursor");
    if (!cursorAdapter) throw new Error("Missing cursor adapter");
    const preview = await cursorAdapter.preview(context(homeDir));
    expect(parsePreviewToken(preview.token)?.assistantId).toBe("cursor");
    expect(preview.willWrite).toBe(false);
    expect(preview.plannedAction).toBe("none");
    expect(preview.targetVersion?.exists).toBe(true);
    expect(preview.targetVersion?.parentSymlink).toBe(false);
    expect(preview.targetVersion?.sha256).toBeString();
    expect(preview.similarServers).toEqual([{ name: "other", reason: "OpenPets-like MCP command or server name" }]);
    expect(JSON.stringify(preview)).not.toContain("mcpServers");
  });

  test("apply rejects unknown preview tokens while writes are disabled", async () => {
    const cursorAdapter = assistantSetupAdapters.find((adapter) => adapter.id === "cursor");
    if (!cursorAdapter) throw new Error("Missing cursor adapter");
    await expect(cursorAdapter.apply(context(await makeTempHome()), { previewToken: createPreviewToken("cursor", "unknown") })).resolves.toMatchObject({ ok: false, message: "Setup preview expired or is invalid." });
  });

  test("apply creates missing Cursor config and re-detects configured", async () => {
    const homeDir = await makeTempHome();
    const cursorAdapter = assistantSetupAdapters.find((adapter) => adapter.id === "cursor");
    if (!cursorAdapter) throw new Error("Missing cursor adapter");
    const preview = await cursorAdapter.preview(context(homeDir));
    expect(preview.plannedAction).toBe("create");
    expect(preview.willWrite).toBe(true);
    const result = await cursorAdapter.apply(context(homeDir), { previewToken: preview.token });
    expect(result).toMatchObject({ ok: true, message: "OpenPets MCP config created." });
    expect(result.detection?.configStatus).toBe("configured");
    const written = JSON.parse(await readFile(join(homeDir, ".cursor", "mcp.json"), "utf8"));
    expect(written.mcpServers.openpets).toEqual({ type: "stdio", command: "bunx", args: ["@open-pets/mcp"] });
  });

  test("apply blocks configured-different entries until explicit overwrite UX exists", async () => {
    const homeDir = await makeTempHome();
    await writeJson(join(homeDir, ".cursor", "mcp.json"), { mcpServers: { openpets: { command: "node", args: ["other"] } } });
    const cursorAdapter = assistantSetupAdapters.find((adapter) => adapter.id === "cursor");
    if (!cursorAdapter) throw new Error("Missing cursor adapter");
    const preview = await cursorAdapter.preview(context(homeDir));
    expect(preview.plannedAction).toBe("manual");
    expect(preview.willWrite).toBe(false);
    expect(preview.writeBlockedReason).toContain("existing openpets MCP entry differs");
  });

  test("apply updates Windsurf config with backup and preserves unrelated keys", async () => {
    const homeDir = await makeTempHome();
    const configPath = join(homeDir, ".codeium", "windsurf", "mcp_config.json");
    await writeJson(configPath, { mcpServers: { keep: { command: "safe" } }, unrelated: true });
    const windsurfAdapter = assistantSetupAdapters.find((adapter) => adapter.id === "windsurf");
    if (!windsurfAdapter) throw new Error("Missing windsurf adapter");
    const preview = await windsurfAdapter.preview(context(homeDir));
    expect(preview.plannedAction).toBe("create");
    const result = await windsurfAdapter.apply(context(homeDir), { previewToken: preview.token });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Backup created");
    const written = JSON.parse(await readFile(configPath, "utf8"));
    expect(written.unrelated).toBe(true);
    expect(written.mcpServers.keep).toEqual({ command: "safe" });
    expect(written.mcpServers.openpets).toEqual({ command: "bunx", args: ["@open-pets/mcp"] });
    const files = await readdir(dirname(configPath));
    expect(files.some((file) => file.startsWith("mcp_config.json.openpets-backup-"))).toBe(true);
  });

  test("apply rejects preview tokens for a different assistant", async () => {
    const homeDir = await makeTempHome();
    const cursorAdapter = assistantSetupAdapters.find((adapter) => adapter.id === "cursor");
    const windsurfAdapter = assistantSetupAdapters.find((adapter) => adapter.id === "windsurf");
    if (!cursorAdapter || !windsurfAdapter) throw new Error("Missing adapters");
    const preview = await cursorAdapter.preview(context(homeDir));
    await expect(windsurfAdapter.apply(context(homeDir), { previewToken: preview.token })).resolves.toMatchObject({ ok: false, message: "Setup preview does not match this assistant." });
  });

  test("apply rejects when config changes after preview", async () => {
    const homeDir = await makeTempHome();
    const configPath = join(homeDir, ".cursor", "mcp.json");
    await writeJson(configPath, { mcpServers: {} });
    const cursorAdapter = assistantSetupAdapters.find((adapter) => adapter.id === "cursor");
    if (!cursorAdapter) throw new Error("Missing cursor adapter");
    const preview = await cursorAdapter.preview(context(homeDir));
    await writeJson(configPath, { mcpServers: { changed: true } });
    await expect(cursorAdapter.apply(context(homeDir), { previewToken: preview.token })).resolves.toMatchObject({ ok: false, message: "Config changed since preview. Refresh and review again." });
  });
});

function context(homeDir: string, env: NodeJS.ProcessEnv = {}): DetectionContext {
  return { platform: "linux", homeDir, env };
}

async function makeTempHome() {
  return mkdtemp(join(tmpdir(), "openpets-assistant-setup-"));
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), "utf8");
}
