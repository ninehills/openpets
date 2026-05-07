import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { dirname, parse } from "node:path";
import type { ConfigFileVersion } from "./types.js";

const maxHashBytes = 1024 * 1024;

export async function getConfigFileVersion(path: string): Promise<ConfigFileVersion> {
  try {
    const stats = await lstat(path);
    const isSymlink = stats.isSymbolicLink();
    return {
      exists: true,
      isSymlink,
      parentSymlink: await hasSymlinkParent(dirname(path)),
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      sha256: !isSymlink && stats.isFile() && stats.size <= maxHashBytes ? await hashFile(path) : null,
    };
  } catch (error) {
    if (isNotFoundError(error)) return { exists: false, isSymlink: false, parentSymlink: await hasSymlinkParent(dirname(path)), size: null, mtimeMs: null, sha256: null };
    throw error;
  }
}

export function versionsMatch(a: ConfigFileVersion | null, b: ConfigFileVersion | null) {
  if (!a || !b) return a === b;
  return a.exists === b.exists && a.isSymlink === b.isSymlink && a.parentSymlink === b.parentSymlink && a.size === b.size && a.mtimeMs === b.mtimeMs && a.sha256 === b.sha256;
}

async function hashFile(path: string) {
  const content = await readFile(path);
  return createHash("sha256").update(content).digest("hex");
}

function isNotFoundError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

async function hasSymlinkParent(startPath: string) {
  let current = startPath;
  const root = parse(startPath).root;
  while (current && current !== root) {
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) return true;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
    current = dirname(current);
  }
  return false;
}
