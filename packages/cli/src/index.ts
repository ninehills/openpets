#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { createManualEvent, isOpenPetsState, type OpenPetsState } from "@openpets/core";
import { loadCodexPetDirectory } from "@openpets/pet-format-codex";

const HOST = "127.0.0.1";
const PORT = 4738;
const BASE_URL = `http://${HOST}:${PORT}`;

type CliOptions = Record<string, string | boolean>;

async function main(argv: string[]) {
  const [command, ...rest] = argv;

  switch (command) {
    case "start":
      return start(rest);
    case "event":
      return sendEvent(rest, { silent: false });
    case "show":
    case "hide":
    case "sleep":
    case "quit":
      return windowAction(command);
    case "hook":
      return hook(rest);
    case "integrate":
      return integrate(rest);
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

  const health = await getHealth().catch(() => null);
  if (health?.reachable && health.app !== "openpets") {
    console.error(`Port ${PORT} is in use by a non-OpenPets service.`);
    return 1;
  }
  if (health?.app === "openpets") {
    if (desktopArgs.length > 0) {
      await launchDesktop(desktopArgs, { detached: !debug });
    }
    return waitForHealth();
  }

  await launchDesktop(desktopArgs, { detached: !debug });
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

async function sendEvent(args: string[], options: { silent: boolean }) {
  const [stateValue, ...rest] = args;
  if (!isOpenPetsState(stateValue)) {
    if (!options.silent) console.error(`Invalid OpenPets state: ${stateValue ?? "<missing>"}`);
    return options.silent ? 0 : 1;
  }

  const flags = parseOptions(rest);
  const event = createManualEvent(stateValue, {
    source: typeof flags.source === "string" ? flags.source : "cli",
    type: typeof flags.type === "string" ? flags.type : `state.${stateValue}`,
    ...(typeof flags.message === "string" ? { message: flags.message } : {}),
    ...(typeof flags.tool === "string" ? { tool: flags.tool } : {}),
  });

  const response = await postJson("/event", event).catch((error) => error);
  if (response instanceof Error) {
    if (!options.silent) console.error(response.message);
    return options.silent ? 0 : 1;
  }

  if (!response.ok) {
    if (!options.silent) console.error(response.error ?? "OpenPets rejected event");
    return options.silent ? 0 : 1;
  }

  return 0;
}

async function windowAction(action: "show" | "hide" | "sleep" | "quit") {
  const health = await getHealth().catch(() => null);
  if (health?.reachable && health.app !== "openpets") {
    console.error(`Port ${PORT} is in use by a non-OpenPets service.`);
    return 1;
  }
  if (!health?.app) {
    if (action === "show") {
      await launchDesktop(["--openpets-action", "show"], { detached: true });
      return waitForHealth();
    }
    console.error("OpenPets is not running.");
    return 1;
  }

  await launchDesktop(["--openpets-action", action], { detached: true });
  return 0;
}

async function hook(args: string[]) {
  const [name] = args;
  if (name !== "claude-code") {
    if (process.env.OPENPETS_DEBUG) console.error(`Unknown hook: ${name ?? "<missing>"}`);
    return 0;
  }
  return hookClaudeCode();
}

async function integrate(args: string[]) {
  const [name, ...rest] = args;
  const options = parseOptions(rest);
  const install = Boolean(options.install);

  if (name === "claude-code") {
    const { claudeCodeSnippet } = await import("./integrations/claude-code");
    const snippet = claudeCodeSnippet();
    if (!install) {
      console.log(snippet);
      return 0;
    }
    await installClaudeCodeSnippet(snippet);
    return 0;
  }

  if (name === "opencode") {
    const { openCodePlugin } = await import("./integrations/opencode");
    const plugin = openCodePlugin();
    if (!install) {
      console.log(plugin);
      return 0;
    }
    await installOpenCodePlugin(plugin);
    return 0;
  }

  console.error(`Unknown integration: ${name ?? "<missing>"}`);
  return 1;
}

async function hookClaudeCode() {
  const body = await new Response(Bun.stdin.stream()).text().catch(() => "{}");
  let payload: unknown = {};
  try {
    payload = JSON.parse(body);
  } catch {
    payload = {};
  }

  const event = mapClaudeHookToEvent(payload);
  if (!event) return 0;

  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 400);
    await postJson("/event", event, controller.signal);
  } catch (error) {
    if (process.env.OPENPETS_DEBUG) console.error(error);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  return 0;
}

function mapClaudeHookToEvent(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const hookName = typeof record.hook_event_name === "string" ? record.hook_event_name : "";
  const toolName = typeof record.tool_name === "string" ? record.tool_name : "";
  const toolInput = record.tool_input && typeof record.tool_input === "object"
    ? (record.tool_input as Record<string, unknown>)
    : {};
  const command = typeof toolInput.command === "string" ? toolInput.command.toLowerCase() : "";

  let state: OpenPetsState | null = null;
  if (hookName === "UserPromptSubmit") state = "thinking";
  if (hookName === "PreToolUse" && ["Edit", "Write", "MultiEdit"].includes(toolName)) state = "editing";
  if (hookName === "PreToolUse" && toolName === "Bash") {
    state = /\b(test|vitest|jest|pytest|bun test|npm test)\b/.test(command) ? "testing" : "running";
  }
  if (hookName === "PermissionRequest") state = "waving";
  if (hookName === "Notification") state = "waiting";
  if (hookName === "Stop") state = "success";
  if (hookName === "StopFailure") state = "error";

  if (!state) return null;
  return createManualEvent(state, {
    source: "claude-code",
    type: `claude.${hookName || state}`,
    ...(toolName ? { tool: toolName } : {}),
  });
}

async function getHealth() {
  const response = await fetch(`${BASE_URL}/health`);
  const text = await response.text();
  try {
    return { ...(JSON.parse(text) as { app?: string; ok?: boolean; ready?: boolean }), reachable: true };
  } catch {
    return { app: undefined, ok: false, ready: false, reachable: true };
  }
}

async function waitForHealth() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const health = await getHealth().catch(() => null);
    if (health?.app === "openpets" && health.ready) return 0;
    await Bun.sleep(100);
  }
  console.error("OpenPets did not become ready within 5000ms.");
  return 1;
}

async function postJson(path: string, body: unknown, signal?: AbortSignal) {
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  };
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
  });
  return response.json() as Promise<{ ok: boolean; error?: string }>;
}

async function launchDesktop(args: string[], options: { detached: boolean }) {
  const mainPath = resolve(import.meta.dir, "../../../apps/desktop/dist/main.js");
  const child = spawn("bunx", ["electron", mainPath, ...args], {
    detached: options.detached,
    stdio: options.detached ? "ignore" : "inherit",
  });
  if (options.detached) child.unref();
}

async function installClaudeCodeSnippet(snippet: string) {
  const targetPath = resolve(process.cwd(), ".claude", "settings.local.json");
  await mkdir(dirname(targetPath), { recursive: true });
  const existing = await readJsonFile(targetPath);
  if (existing?.hooks !== undefined && !isRecord(existing.hooks)) {
    throw new Error(`${targetPath} has non-object hooks; aborting to avoid unsafe merge.`);
  }
  if (existing !== null) {
    await backupFile(targetPath);
  }

  const next = mergeClaudeSettings(existing ?? {}, JSON.parse(snippet) as Record<string, unknown>);
  await writeFile(targetPath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Installed Claude Code OpenPets hooks to ${targetPath}`);
}

async function installOpenCodePlugin(plugin: string) {
  const targetPath = resolve(process.cwd(), ".opencode", "plugins", "openpets.ts");
  await mkdir(dirname(targetPath), { recursive: true });
  if (await fileExists(targetPath)) {
    await backupFile(targetPath);
  }
  await writeFile(targetPath, plugin);
  console.log(`Installed OpenCode OpenPets plugin to ${targetPath}`);
}

async function readJsonFile(path: string) {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function mergeClaudeSettings(existing: Record<string, unknown>, snippet: Record<string, unknown>) {
  return {
    ...existing,
    hooks: mergeHookConfig(
      isRecord(existing.hooks) ? existing.hooks : {},
      isRecord(snippet.hooks) ? snippet.hooks : {},
    ),
  };
}

function mergeHookConfig(existing: Record<string, unknown>, incoming: Record<string, unknown>) {
  const result: Record<string, unknown> = { ...existing };
  for (const [hookName, hookEntries] of Object.entries(incoming)) {
    const current = Array.isArray(result[hookName]) ? result[hookName] : [];
    result[hookName] = uniqueJsonEntries([...current, ...(Array.isArray(hookEntries) ? hookEntries : [])]);
  }
  return result;
}

function uniqueJsonEntries(entries: unknown[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = JSON.stringify(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function fileExists(path: string) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function backupFile(path: string) {
  await copyFile(path, `${path}.bak-${Date.now()}`);
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
  openpets start [--pet ./examples/pets/slayer]
  openpets start [--pet ./examples/pets/slayer] [--scale 1]
  openpets start --debug [--pet ./examples/pets/slayer] [--scale 1]
  openpets event <state> [--source cli] [--message text] [--tool tool] [--type type]
  openpets show|hide|sleep|quit
  openpets hook claude-code
  openpets integrate claude-code [--print|--install]
  openpets integrate opencode [--print|--install]
`);
}

const exitCode = await main(Bun.argv.slice(2));
process.exit(exitCode);
