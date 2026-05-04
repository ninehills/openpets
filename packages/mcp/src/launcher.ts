import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type DesktopLauncher = () => Promise<void>;

export async function launchOpenPetsDesktop() {
  const commandOverride = process.env.OPENPETS_DESKTOP_COMMAND?.trim();
  if (commandOverride) {
    launchCommand(commandOverride, [], { shell: true });
    return;
  }

  const appOverride = process.env.OPENPETS_DESKTOP_APP?.trim();
  if (appOverride) {
    await openDesktopAppOverride(appOverride);
    return;
  }

  if (process.platform === "darwin") {
    try {
      await openMacApp("OpenPets");
      return;
    } catch {
      // Fall through to the monorepo dev launcher below.
    }
  }

  if (process.platform === "win32") {
    const exePath = findWindowsOpenPetsExe();
    if (exePath) {
      launchCommand(exePath, [], { shell: false });
      return;
    }
  }

  if (process.platform === "linux") {
    const linuxCommand = findLinuxOpenPetsCommand();
    if (linuxCommand) {
      launchCommand(linuxCommand, [], { shell: false });
      return;
    }
  }

  const mainPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/desktop/dist/main.js");
  if (!existsSync(mainPath)) {
    throw new Error("OpenPets desktop app is not installed or the local desktop build is missing");
  }

  launchCommand("bunx", ["electron", mainPath], { shell: false });
}

async function openDesktopAppOverride(value: string) {
  if (process.platform === "darwin") {
    if (existsSync(value)) {
      await openMacPath(value);
    } else {
      await openMacApp(value);
    }
    return;
  }

  launchCommand(value, [], { shell: false });
}

function launchCommand(command: string, args: string[], options: { shell: boolean }) {
  const child = spawn(command, args, {
    detached: true,
    shell: options.shell,
    stdio: "ignore",
  });
  child.unref();
}

async function openMacApp(appNameOrPath: string) {
  const result = spawnSync("open", ["-a", appNameOrPath], {
    stdio: "ignore",
  });
  if (result.status !== 0 || result.error) {
    throw new Error(`OpenPets desktop app could not be opened: ${appNameOrPath}`);
  }
}

async function openMacPath(path: string) {
  const result = spawnSync("open", [path], {
    stdio: "ignore",
  });
  if (result.status !== 0 || result.error) {
    throw new Error(`OpenPets desktop app could not be opened: ${path}`);
  }
}

function findWindowsOpenPetsExe() {
  const candidates = [
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs", "OpenPets", "OpenPets.exe") : undefined,
    process.env.ProgramFiles ? join(process.env.ProgramFiles, "OpenPets", "OpenPets.exe") : undefined,
    process.env["ProgramFiles(x86)"] ? join(process.env["ProgramFiles(x86)"]!, "OpenPets", "OpenPets.exe") : undefined,
  ].filter((item): item is string => Boolean(item));
  return candidates.find((candidate) => existsSync(candidate));
}

function findLinuxOpenPetsCommand() {
  const candidates = [
    "/opt/OpenPets/openpets",
    "/opt/OpenPets/OpenPets",
    "/usr/bin/openpets",
    "/usr/local/bin/openpets",
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? (commandExists("openpets") ? "openpets" : null);
}

function commandExists(command: string) {
  const lookup = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookup, [command], { stdio: "ignore" });
  return result.status === 0;
}

export async function sleep(ms: number) {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
