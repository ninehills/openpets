#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import JSZip from "jszip";
import { getHealth, selectPet as selectOpenPetsPet, sendEvent as sendOpenPetsEvent, windowAction as sendWindowAction, type OpenPetsHealth } from "@open-pets/client";
import { isOpenPetsState } from "@open-pets/core";
import { getOpenPetsConfigPath, getOpenPetsPetsDir, type OpenPetsConfig } from "@open-pets/core/config";
import { loadCodexPetDirectory, type LoadedCodexPet } from "@open-pets/pet-format-codex";

type CliOptions = Record<string, string | boolean>;

const MAX_ZIP_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 100 * 1024 * 1024;
const MAX_ZIP_FILES = 300;
const INSTALL_DOWNLOAD_TIMEOUT_MS = 30_000;

async function main(argv: string[]) {
  const [command, ...rest] = argv;

  switch (command) {
    case "start":
      return start(rest);
    case "event":
      return sendEvent(rest, { silent: false });
    case "install":
      return installPet(rest);
    case "show":
    case "hide":
    case "sleep":
    case "quit":
      return windowAction(command);
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      return 0;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      return 1;
  }
}

async function start(args: string[]) {
  const options = parseOptions(args);
  const desktopArgs = [] as string[];
  const debug = Boolean(options.debug) || process.env.OPENPETS_DEBUG === "1";
  if (debug) desktopArgs.push("--openpets-debug");
  if (typeof options.scale === "string") {
    const scale = Number(options.scale);
    if (!Number.isFinite(scale) || scale < 0.25 || scale > 2) {
      console.error("Scale must be a number between 0.25 and 2.");
      return 1;
    }
    desktopArgs.push("--scale", String(scale));
  }
  if (typeof options.pet === "string") {
    const validation = await validatePetArgument(options.pet);
    if (!validation.ok) {
      console.error(validation.error);
      return 1;
    }
    desktopArgs.push("--pet", validation.path);
  }

  const health = await readHealthForCli();
  if (!(health instanceof Error) && health.app === "openpets") {
    if (desktopArgs.length > 0) {
      const launched = await launchDesktopForCli(desktopArgs, { detached: !debug });
      if (!launched) return 1;
    }
    return waitForHealth();
  }

  const launched = await launchDesktopForCli(desktopArgs, { detached: !debug });
  if (!launched) return 1;
  return waitForHealth();
}

async function validatePetArgument(petPath: string) {
  const resolvedPath = resolve(petPath);
  if (extname(resolvedPath).toLowerCase() === ".zip") {
    return { ok: false as const, error: "Zip pet imports are not supported yet. Pass a local Codex/Petdex pet directory." };
  }

  const result = await loadCodexPetDirectory(resolvedPath);
  if (!result.ok) {
    return { ok: false as const, error: result.issues.map((item) => item.message).join("\n") };
  }
  return { ok: true as const, path: result.pet.directory };
}

async function installPet(args: string[]) {
  const [source] = args;
  if (!source) {
    console.error("Usage: openpets install <zip-url|local-zip|pet-folder>");
    return 1;
  }

  const installed: LoadedCodexPet | Error = await installPetSource(source).catch((error: unknown) => error instanceof Error ? error : new Error(String(error)));
  if (installed instanceof Error) {
    console.error(installed.message);
    return 1;
  }

  const health = await readHealthForCli();
  if (!(health instanceof Error)) {
    if (health.capabilities.includes("pet-v1")) {
      const selected = await selectOpenPetsPet(installed.directory, { timeoutMs: 3000 }).catch((error: unknown) => error instanceof Error ? error : new Error(String(error)));
      if (selected instanceof Error) {
        console.log(`Installed ${installed.displayName}. Restart OpenPets to use it.`);
        if (process.env.OPENPETS_DEBUG) console.error(selected);
        return 0;
      }
      console.log(`Installed and activated ${selected.pet.displayName}.`);
      return 0;
    }

    console.error("OpenPets is running but does not support live pet installs. Update and restart OpenPets, then rerun this install command.");
    return 1;
  }

  const config = await readConfigForCli();
  await writeConfigForCli({ ...config, petPath: installed.directory });
  console.log(`Installed ${installed.displayName}. Open OpenPets to use it.`);
  return 0;
}

async function installPetSource(source: string) {
  const staging = await mkdtemp(join(tmpdir(), "openpets-install-"));
  try {
    const sourceInfo = await stagePetSource(source, staging);
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

async function stagePetSource(source: string, staging: string) {
  if (isHttpsUrl(source)) {
    const bytes = await downloadZip(source);
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
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

async function downloadZip(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INSTALL_DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
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
  const files = Object.values(zip.files).filter((entry) => !entry.dir && !isJunkZipPath(entry.name));
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
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await copyFile(sourcePath, targetPath);
    }
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

async function readConfigForCli(): Promise<OpenPetsConfig> {
  try {
    return JSON.parse(await readFile(getOpenPetsConfigPath(), "utf8")) as OpenPetsConfig;
  } catch {
    return {};
  }
}

async function writeConfigForCli(config: OpenPetsConfig) {
  const configPath = getOpenPetsConfigPath();
  await mkdir(dirname(configPath), { recursive: true });
  const tempPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`);
  await rename(tempPath, configPath);
}

async function sendEvent(args: string[], options: { silent: boolean }) {
  const [stateValue, ...rest] = args;
  if (!isOpenPetsState(stateValue)) {
    if (!options.silent) console.error(`Invalid OpenPets state: ${stateValue ?? "<missing>"}`);
    return options.silent ? 0 : 1;
  }

  const flags = parseOptions(rest);
  const response = await sendOpenPetsEvent({
    state: stateValue,
    source: typeof flags.source === "string" ? flags.source : "cli",
    type: typeof flags.type === "string" ? flags.type : `state.${stateValue}`,
    ...(typeof flags.message === "string" ? { message: flags.message } : {}),
    ...(typeof flags.tool === "string" ? { tool: flags.tool } : {}),
  }).catch((error: unknown) => error);
  if (response instanceof Error) {
    if (!options.silent) console.error(response.message);
    return options.silent ? 0 : 1;
  }

  return 0;
}

async function windowAction(action: "show" | "hide" | "sleep" | "quit") {
  const health = await readHealthForCli();
  if (health instanceof Error) {
    if (action === "show") {
      const launched = await launchDesktopForCli(["--openpets-action", "show"], { detached: true });
      if (!launched) return 1;
      return waitForHealth();
    }
    console.error("OpenPets is not running.");
    return 1;
  }

  const response = await sendWindowAction(action).catch((error: unknown) => error);
  if (response instanceof Error) {
    console.error(response.message);
    return 1;
  }
  return 0;
}

async function readHealthForCli(): Promise<OpenPetsHealth | Error> {
  return getHealth({ timeoutMs: 500 }).catch((error: unknown) => error instanceof Error ? error : new Error(String(error)));
}

async function waitForHealth() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const health = await readHealthForCli();
    if (!(health instanceof Error) && health.ready) return 0;
    await Bun.sleep(100);
  }
  console.error("OpenPets did not become ready within 5000ms.");
  return 1;
}

async function launchDesktop(args: string[], options: { detached: boolean }) {
  const mainPath = resolve(import.meta.dir, "../../../apps/desktop/dist/main.js");
  const mainStat = await stat(mainPath).catch(() => null);
  if (!mainStat?.isFile()) {
    throw new Error("openpets start is only available from a source checkout. Launch the installed OpenPets desktop app instead.");
  }
  const child = spawn("bunx", ["electron", mainPath, ...args], {
    detached: options.detached,
    stdio: options.detached ? "ignore" : "inherit",
  });
  if (options.detached) child.unref();
}

async function launchDesktopForCli(args: string[], options: { detached: boolean }) {
  const result = await launchDesktop(args, options).catch((error: unknown) => error);
  if (result instanceof Error) {
    console.error(result.message);
    return false;
  }
  return true;
}

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
}

function printHelp() {
  console.log(`OpenPets

Usage:
  openpets install <zip-url|local-zip|pet-folder>
  openpets start [--pet ./examples/pets/slayer]
  openpets start [--pet ./examples/pets/slayer] [--scale 1]
  openpets start --debug [--pet ./examples/pets/slayer] [--scale 1]
  openpets event <state> [--source cli] [--message text] [--tool tool] [--type type]
  openpets show|hide|sleep|quit

Integrations:
  Claude Code: bunx @open-pets/claude-pets install
  OpenCode:    bunx opencode-pets install
`);
}

const exitCode = await main(Bun.argv.slice(2));
process.exit(exitCode);
