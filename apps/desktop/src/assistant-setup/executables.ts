import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { BunxStatus, DetectionContext } from "./types.js";

export async function detectBunxStatus(context: DetectionContext): Promise<BunxStatus> {
  return (await findExecutableInPath(context, context.platform === "win32" ? ["bunx.cmd", "bunx.exe", "bunx"] : ["bunx"])) ? "found" : "unknown";
}

export async function hasAssistantExecutable(context: DetectionContext, executableNames: readonly string[]) {
  return findExecutableInPath(context, executableNames);
}

async function findExecutableInPath(context: DetectionContext, executableNames: readonly string[]) {
  const rawPath = context.env.PATH ?? context.env.Path ?? context.env.path;
  if (!rawPath) return false;
  const directories = rawPath.split(delimiter).filter(Boolean);
  for (const directory of directories) {
    for (const executableName of executableNames) {
      if (await canAccess(join(directory, executableName))) return true;
    }
  }
  return false;
}

async function canAccess(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
