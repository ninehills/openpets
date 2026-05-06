#!/usr/bin/env bun
import { installAndActivatePet } from "@open-pets/installer";

export const DEFAULT_CATALOG_URL = "https://openpets.dev/pets/install.json";
const CATALOG_FETCH_TIMEOUT_MS = 10_000;
const MAX_CATALOG_BYTES = 1024 * 1024;
const INSTALL_ID_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

type CatalogPet = {
  installId: string;
  displayName: string;
  zipPath: string;
};

type InstallCatalog = {
  version: 1;
  generatedAt: string;
  pets: CatalogPet[];
};

export async function main(argv: string[]) {
  const { installId, catalogUrl, help } = parseArgs(argv);
  if (help) {
    printHelp();
    return 0;
  }
  if (!installId) {
    printHelp();
    return 1;
  }
  if (!isValidInstallId(installId)) {
    console.error(`Invalid pet: ${installId}`);
    console.error("Use a pet id like clawd, cinder, or codexpet.");
    return 1;
  }

  const catalogResult = await fetchInstallCatalog(catalogUrl);
  if (!catalogResult.ok) {
    console.error(catalogResult.message);
    return 1;
  }

  const pet = catalogResult.catalog.pets.find((item) => item.installId === installId);
  if (!pet) {
    console.error(`Unknown pet: ${installId}`);
    console.error("Try one from https://openpets.dev");
    return 1;
  }

  const displayName = safeDisplayName(pet.displayName);
  const zipUrl = resolveZipUrl(pet.zipPath, catalogUrl);
  if (zipUrl instanceof Error) {
    console.error(zipUrl.message);
    return 1;
  }

  console.log(`Installing ${displayName}...`);
  const result = await installAndActivatePet(zipUrl.href, { enforceSameOriginRedirects: true });
  if (!result.ok) {
    console.error(result.message);
    return 1;
  }
  if (result.activated) {
    console.log(`Installed and activated ${safeDisplayName(result.activationDisplayName ?? result.displayName)}.`);
  } else if (result.openPetsRunning) {
    console.log(`Installed ${safeDisplayName(result.displayName)}. Restart OpenPets to use it.`);
  } else {
    console.log(`Installed ${safeDisplayName(result.displayName)}. Open OpenPets to use it.`);
  }
  return 0;
}

export function parseArgs(argv: string[]) {
  let installId: string | undefined;
  let catalogUrl = DEFAULT_CATALOG_URL;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h" || arg === "help") {
      help = true;
      continue;
    }
    if (arg === "--catalog") {
      const next = argv[index + 1];
      if (next) {
        catalogUrl = next;
        index += 1;
      }
      continue;
    }
    if (!installId && arg && !arg.startsWith("--")) installId = arg;
  }

  return { installId, catalogUrl, help };
}

export function isValidInstallId(value: string) {
  return value.length <= 80 && INSTALL_ID_PATTERN.test(value);
}

export async function fetchInstallCatalog(catalogUrl: string): Promise<{ ok: true; catalog: InstallCatalog } | { ok: false; message: string }> {
  const url = validateCatalogUrl(catalogUrl);
  if (url instanceof Error) return { ok: false, message: url.message };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CATALOG_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return { ok: false, message: `Could not reach ${catalogUrl}\nCheck your connection or try again later.` };
    if (!response.body) return { ok: false, message: "Catalog response did not include a body." };

    const bytes = await readResponseBytes(response);
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return validateCatalog(parsed);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, message: `Could not reach ${catalogUrl}\nCheck your connection or try again later.` };
    }
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

export function validateCatalog(value: unknown): { ok: true; catalog: InstallCatalog } | { ok: false; message: string } {
  if (!isRecord(value) || value.version !== 1 || typeof value.generatedAt !== "string" || !Array.isArray(value.pets)) {
    return { ok: false, message: "Install catalog is invalid." };
  }

  const seen = new Set<string>();
  const pets: CatalogPet[] = [];
  for (const item of value.pets) {
    if (!isRecord(item) || typeof item.installId !== "string" || typeof item.displayName !== "string" || typeof item.zipPath !== "string") {
      return { ok: false, message: "Install catalog contains an invalid pet entry." };
    }
    if (!isValidInstallId(item.installId)) return { ok: false, message: `Install catalog contains an invalid pet id: ${item.installId}` };
    if (seen.has(item.installId)) return { ok: false, message: `Install catalog contains a duplicate pet id: ${item.installId}` };
    seen.add(item.installId);
    pets.push({ installId: item.installId, displayName: item.displayName, zipPath: item.zipPath });
  }

  return { ok: true, catalog: { version: 1, generatedAt: value.generatedAt, pets } };
}

const ALLOWED_ZIP_ORIGIN = "https://zip.openpets.dev";
const ALLOWED_CATALOG_ORIGIN = "https://openpets.dev";

export function resolveZipUrl(zipPath: string, catalogUrl: string) {
  // Check for dangerous characters in all cases
  if (zipPath.includes("?") || zipPath.includes("#") || zipPath.includes("\\")) {
    return new Error("Install catalog contains an unsafe pet zip path.");
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(zipPath);
  } catch {
    return new Error("Install catalog contains an unsafe pet zip path.");
  }
  if (decoded.includes("..") || decoded.includes("\\")) {
    return new Error("Install catalog contains an unsafe pet zip path.");
  }

  // Handle absolute URLs (R2 zip URLs)
  if (zipPath.startsWith("https://")) {
    let url: URL;
    try {
      url = new URL(zipPath);
    } catch {
      return new Error("Install catalog contains an unsafe pet zip path.");
    }
    // Must be HTTPS
    if (url.protocol !== "https:") {
      return new Error("Install catalog contains an unsafe pet zip path.");
    }
    // Must be from allowed origin
    if (url.origin !== ALLOWED_ZIP_ORIGIN) {
      return new Error("Install catalog contains an unsafe pet zip origin.");
    }
    // Must end with .zip
    if (!url.pathname.endsWith(".zip")) {
      return new Error("Install catalog contains an unsafe pet zip path.");
    }
    // Must be under /pets/
    if (!url.pathname.startsWith("/pets/")) {
      return new Error("Install catalog contains an unsafe pet zip path.");
    }
    return url;
  }

  // Handle relative paths (legacy)
  if (!zipPath.startsWith("/pets/") || !zipPath.endsWith(".zip")) {
    return new Error("Install catalog contains an unsafe pet zip path.");
  }

  const catalog = validateCatalogUrl(catalogUrl);
  if (catalog instanceof Error) return catalog;
  const resolved = new URL(zipPath, catalog);
  if (resolved.origin !== catalog.origin || resolved.protocol !== catalog.protocol) {
    return new Error("Install catalog contains a cross-origin pet zip path.");
  }
  if (catalog.href === DEFAULT_CATALOG_URL && resolved.origin !== ALLOWED_CATALOG_ORIGIN) {
    return new Error("Install catalog contains an unsafe pet zip origin.");
  }
  return resolved;
}

export function safeDisplayName(value: string) {
  const cleaned = value
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim()
    .slice(0, 80);
  return cleaned || "pet";
}

async function readResponseBytes(response: Response) {
  const length = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_CATALOG_BYTES) throw new Error("Install catalog is too large.");

  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_CATALOG_BYTES) throw new Error("Install catalog is too large.");
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes);
}

function validateCatalogUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return new Error("Catalog URL must use HTTPS.");
    return url;
  } catch {
    return new Error("Catalog URL is invalid.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function printHelp() {
  console.log(`OpenPets pet installer

Usage:
  install-pet <pet-id>
  install-pet <pet-id> --catalog https://openpets.dev/pets/install.json

Example:
  install-pet clawd
`);
}

if (import.meta.main) {
  const exitCode = await main(Bun.argv.slice(2));
  process.exit(exitCode);
}
