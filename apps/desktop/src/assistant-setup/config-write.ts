import { constants } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AssistantId } from "./types.js";
import { asRecord, parseConfigText } from "./config-json.js";

export async function applyJsonMcpConfig(assistantId: AssistantId, targetPath: string) {
  if (assistantId !== "cursor" && assistantId !== "windsurf") throw new Error("Automatic JSON writes are not enabled for this assistant.");

  const existing = await readExistingJson(targetPath);
  const config = existing.value;
  const serversKey = "mcpServers";
  if (serversKey in config && !asRecord(config[serversKey])) throw new Error("mcpServers must be a JSON object.");
  const servers = asRecord(config[serversKey]) ?? {};
  config[serversKey] = {
    ...servers,
    openpets: expectedServerConfig(assistantId),
  };

  await mkdir(dirname(targetPath), { recursive: true });
  let backupPath: string | null = null;
  if (existing.exists) {
    backupPath = `${targetPath}.openpets-backup-${Date.now()}-${randomUUID()}`;
    await copyFile(targetPath, backupPath, constants.COPYFILE_EXCL);
  }

  const mode = existing.mode ?? 0o600;
  const tempPath = join(dirname(targetPath), `.openpets-${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, { mode });
    await rename(tempPath, targetPath);
    await chmod(targetPath, mode).catch(() => undefined);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }

  return { backupPath };
}

function expectedServerConfig(assistantId: AssistantId) {
  if (assistantId === "cursor") {
    return { type: "stdio", command: "bunx", args: ["@open-pets/mcp"] };
  }
  return { command: "bunx", args: ["@open-pets/mcp"] };
}

async function readExistingJson(targetPath: string): Promise<{ exists: boolean; value: Record<string, unknown>; mode: number | null }> {
  try {
    const [text, stats] = await Promise.all([readFile(targetPath, "utf8"), stat(targetPath)]);
    const parsed = parseConfigText(text, "json");
    if (!parsed.ok) throw new Error(parsed.error);
    const value = asRecord(parsed.value);
    if (!value) throw new Error("Config root must be a JSON object.");
    return { exists: true, value, mode: stats.mode & 0o777 };
  } catch (error) {
    if (isNotFoundError(error)) return { exists: false, value: {}, mode: null };
    throw error;
  }
}

function isNotFoundError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}
