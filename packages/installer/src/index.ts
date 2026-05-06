import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { getHealth, selectPet as selectOpenPetsPet, type OpenPetsHealth } from "@open-pets/client";
import { getOpenPetsConfigPath, getOpenPetsPetsDir, type OpenPetsConfig } from "@open-pets/core/config";
import { loadCodexPetDirectory, type LoadedCodexPet } from "@open-pets/pet-format-codex";
import JSZip from "jszip";

const MAX_ZIP_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 100 * 1024 * 1024;
const MAX_ZIP_FILES = 300;
const INSTALL_DOWNLOAD_TIMEOUT_MS = 30_000;

export type InstallPetResult =
  | {
      ok: true;
      displayName: string;
      directory: string;
      activated: boolean;
      activationDisplayName?: string;
      openPetsRunning: boolean;
    }
  | { ok: false; message: string };

export type InstallPetOptions = {
  enforceSameOriginRedirects?: boolean;
};

export async function installAndActivatePet(source: string, options: InstallPetOptions = {}): Promise<InstallPetResult> {
  try {
    const installed = await installPetSource(source, options);
    const health: OpenPetsHealth | Error = await getHealth({ timeoutMs: 500 }).catch((error: unknown) => error instanceof Error ? error : new Error(String(error)));

    if (!(health instanceof Error)) {
      if (!health.capabilities.includes("pet-v1")) {
        return {
          ok: false,
          message: "OpenPets is running but does not support live pet installs. Update and restart OpenPets, then rerun this install command.",
        };
      }

      const selected = await selectOpenPetsPet(installed.directory, { timeoutMs: 3000 }).catch((error: unknown) => error instanceof Error ? error : new Error(String(error)));
      if (selected instanceof Error) {
        if (process.env.OPENPETS_DEBUG) console.error(selected);
        return {
          ok: true,
          displayName: installed.displayName,
          directory: installed.directory,
          activated: false,
          openPetsRunning: true,
        };
      }

      return {
        ok: true,
        displayName: installed.displayName,
        activationDisplayName: selected.pet.displayName,
        directory: installed.directory,
        activated: true,
        openPetsRunning: true,
      };
    }

    const config = await readConfig();
    await writeConfig({ ...config, petPath: installed.directory });
    return {
      ok: true,
      displayName: installed.displayName,
      directory: installed.directory,
      activated: false,
      openPetsRunning: false,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export async function installPetSource(source: string, options: InstallPetOptions = {}): Promise<LoadedCodexPet> {
  const staging = await mkdtemp(join(tmpdir(), "openpets-install-"));
  try {
    const sourceInfo = await stagePetSource(source, staging, options);
    const candidateDirs = await findCandidatePetDirs(staging);
    const loadedPets = [];
    for (const dir of candidateDirs) {
      const loaded = await loadCodexPetDirectory(dir);
      if (loaded.ok) loadedPets.push(loaded.pet);
    }
    if (loadedPets.length === 0) throw new Error("No valid OpenPets/Codex pet found in install source.");
    if (loadedPets.length > 1) throw new Error("Install source contains multiple pet folders; install one pet at a time.");

    const pet = loadedPets[0]!;
    const hash = createHash("sha256").update(sourceInfo.hashInput).digest("hex").slice(0, 8);
    const finalDir = join(getOpenPetsPetsDir(), `${safeSlug(pet.id)}-${hash}`);
    const tempFinalDir = `${finalDir}.tmp-${process.pid}-${Date.now()}`;
    await mkdir(dirname(finalDir), { recursive: true });
    await rm(tempFinalDir, { recursive: true, force: true });
    await copyDirectory(pet.directory, tempFinalDir);
    const finalLoaded = await loadCodexPetDirectory(tempFinalDir);
    if (!finalLoaded.ok) throw new Error(finalLoaded.issues.map((item) => item.message).join("\n"));
    await rm(finalDir, { recursive: true, force: true });
    await rename(tempFinalDir, finalDir);
    const installed = await loadCodexPetDirectory(finalDir);
    if (!installed.ok) throw new Error(installed.issues.map((item) => item.message).join("\n"));
    return installed.pet;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function stagePetSource(source: string, staging: string, options: InstallPetOptions) {
  if (isHttpsUrl(source)) {
    const bytes = await downloadZip(source, options);
    await extractZip(bytes, staging);
    return { hashInput: bytes };
  }

  const localPath = resolve(source);
  const localStat = await stat(localPath).catch(() => null);
  if (!localStat) throw new Error(`Install source not found: ${source}`);
  if (localStat.isDirectory()) {
    const target = join(staging, safeSlug(basename(localPath) || "pet"));
    await copyDirectory(localPath, target);
    return { hashInput: Buffer.from(localPath) };
  }
  if (localStat.isFile() && extname(localPath).toLowerCase() === ".zip") {
    const bytes = await readFile(localPath);
    if (bytes.byteLength > MAX_ZIP_BYTES) throw new Error("Pet zip is too large.");
    await extractZip(bytes, staging);
    return { hashInput: bytes };
  }

  throw new Error("Install source must be an https zip URL, local .zip file, or pet folder.");
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

async function downloadZip(url: string, options: InstallPetOptions) {
  const sourceUrl = new URL(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INSTALL_DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    const finalUrl = new URL(response.url);
    if (finalUrl.protocol !== "https:" || (options.enforceSameOriginRedirects && finalUrl.origin !== sourceUrl.origin)) throw new Error("Pet zip download redirected to an unsafe URL.");
    const length = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(length) && length > MAX_ZIP_BYTES) throw new Error("Pet zip is too large.");
    if (!response.body) throw new Error("Download response did not include a body.");

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_ZIP_BYTES) throw new Error("Pet zip is too large.");
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("Pet zip download timed out.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function extractZip(bytes: Buffer, staging: string) {
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.values(zip.files).filter((entry): entry is JSZip.JSZipObject => !entry.dir && !isJunkZipPath(entry.name));
  if (files.length > MAX_ZIP_FILES) throw new Error("Pet zip contains too many files.");
  let totalBytes = 0;

  for (const file of files) {
    validateZipEntryPath(file.name);
    const declaredSize = getDeclaredUncompressedSize(file);
    if (declaredSize !== null) {
      totalBytes += declaredSize;
      if (totalBytes > MAX_EXTRACTED_BYTES) throw new Error("Pet zip extracts to too much data.");
    }
    const content = Buffer.from(await file.async("uint8array"));
    if (declaredSize === null) {
      totalBytes += content.byteLength;
      if (totalBytes > MAX_EXTRACTED_BYTES) throw new Error("Pet zip extracts to too much data.");
    }
    if (declaredSize !== null && content.byteLength !== declaredSize) throw new Error("Pet zip entry size changed during extraction.");
    const targetPath = resolve(staging, file.name);
    ensureInsideDirectory(staging, targetPath);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content);
  }
}

function getDeclaredUncompressedSize(file: JSZip.JSZipObject) {
  const data = (file as unknown as { _data?: { uncompressedSize?: unknown } })._data;
  return typeof data?.uncompressedSize === "number" && Number.isFinite(data.uncompressedSize) ? data.uncompressedSize : null;
}

function validateZipEntryPath(path: string) {
  const normalized = path.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("../") || normalized === ".." || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`Unsafe path in pet zip: ${path}`);
  }
}

function isJunkZipPath(path: string) {
  return path.startsWith("__MACOSX/") || path.endsWith("/.DS_Store") || basename(path) === ".DS_Store";
}

async function findCandidatePetDirs(root: string) {
  const result: string[] = [];
  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === "pet.json")) result.push(dir);
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== "__MACOSX") await walk(join(dir, entry.name));
    }
  }
  await walk(root);
  return result;
}

async function copyDirectory(source: string, target: string) {
  await mkdir(target, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) await copyDirectory(sourcePath, targetPath);
    else if (entry.isFile()) await copyFile(sourcePath, targetPath);
  }
}

function ensureInsideDirectory(parent: string, child: string) {
  const rel = relative(resolve(parent), resolve(child));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).includes("..")) {
    throw new Error("Pet zip tried to write outside the install directory.");
  }
}

function safeSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "pet";
}

async function readConfig(): Promise<OpenPetsConfig> {
  try {
    return JSON.parse(await readFile(getOpenPetsConfigPath(), "utf8")) as OpenPetsConfig;
  } catch {
    return {};
  }
}

async function writeConfig(config: OpenPetsConfig) {
  const configPath = getOpenPetsConfigPath();
  await mkdir(dirname(configPath), { recursive: true });
  const tempPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`);
  await rename(tempPath, configPath);
}
