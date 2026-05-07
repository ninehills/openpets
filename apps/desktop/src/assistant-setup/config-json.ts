import { readFile } from "node:fs/promises";

export type ParsedConfig = {
  ok: true;
  value: unknown;
} | {
  ok: false;
  error: string;
};

export async function readConfigFile(path: string, format: "json" | "jsonc"): Promise<ParsedConfig | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) return null;
    return { ok: false, error: "Config file could not be read." };
  }
  return parseConfigText(text, format);
}

export function parseConfigText(text: string, format: "json" | "jsonc"): ParsedConfig {
  try {
    return { ok: true, value: JSON.parse(format === "jsonc" ? stripJsonComments(text) : text) };
  } catch {
    return { ok: false, error: "Config file is not valid JSON." };
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function getRecordProperty(value: unknown, key: string): Record<string, unknown> | null {
  return asRecord(asRecord(value)?.[key]);
}

function stripJsonComments(text: string) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/,\s*([}\]])/g, "$1");
}

function isNotFoundError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}
