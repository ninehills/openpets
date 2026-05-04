import { basename, resolve, sep } from "node:path";

export function isPathInside(parent: string, child: string) {
  const parentPath = resolve(parent);
  const childPath = resolve(child);
  return childPath === parentPath || childPath.startsWith(`${parentPath}${sep}`);
}

export function derivePetIdFromDirectory(directory: string) {
  return basename(resolve(directory)).trim() || "sample-pet";
}

export function sanitizeManifestString(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function parseManifestJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}
