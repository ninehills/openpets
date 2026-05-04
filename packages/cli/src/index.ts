#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { extname, resolve } from "node:path";
import { getHealth, sendEvent as sendOpenPetsEvent, OpenPetsClientError, type OpenPetsHealth } from "@openpets/client";
import { isOpenPetsState } from "@openpets/core";
import { loadCodexPetDirectory } from "@openpets/pet-format-codex";

const PORT = 4738;

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
  if (isPortOwnedByAnotherService(health)) {
    console.error(`Port ${PORT} is in use by a non-OpenPets service.`);
    return 1;
  }
  if (!(health instanceof Error) && health.app === "openpets") {
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
  if (isPortOwnedByAnotherService(health)) {
    console.error(`Port ${PORT} is in use by a non-OpenPets service.`);
    return 1;
  }
  if (health instanceof Error) {
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

async function readHealthForCli(): Promise<OpenPetsHealth | Error> {
  return getHealth({ timeoutMs: 500 }).catch((error: unknown) => error instanceof Error ? error : new Error(String(error)));
}

function isPortOwnedByAnotherService(result: OpenPetsHealth | Error) {
  if (!(result instanceof OpenPetsClientError)) return false;
  return result.code === "not-openpets" || result.code === "invalid-response" || result.code === "incompatible-protocol";
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
  const child = spawn("bunx", ["electron", mainPath, ...args], {
    detached: options.detached,
    stdio: options.detached ? "ignore" : "inherit",
  });
  if (options.detached) child.unref();
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

Integrations:
  Claude Code: bunx claude-pets install
  OpenCode:    bunx opencode-pets install
`);
}

const exitCode = await main(Bun.argv.slice(2));
process.exit(exitCode);
