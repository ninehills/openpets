import { spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { accessSync } from "node:fs";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const MAX_EXISTING_SHIM_BYTES = 16 * 1024;

export const POSIX_CLI_SHIM_BODY = `#!/bin/sh
# OpenPets CLI shim v1
exec bunx --package @open-pets/cli openpets "$@"
`;

export const WINDOWS_CLI_SHIM_BODY = "@echo off\r\nREM OpenPets CLI shim v1\r\nbunx --package @open-pets/cli openpets %*\r\n";

export type CliShimInstallResult = {
  status: "installed" | "updated" | "already-installed";
  path: string;
  pathOnPath: boolean;
  shadowedBy: string | null;
};

export type CliShimInstallIssue = {
  code: "bunx-missing" | "conflict";
  message: string;
  path?: string;
};

export type CliShimInstallOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir: string;
  now?: number;
};

export async function installCliShim(options: CliShimInstallOptions): Promise<CliShimInstallResult | CliShimInstallIssue> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (!commandExists("bunx", env, platform)) {
    return { code: "bunx-missing", message: "OpenPets could not find bunx on the desktop app PATH. Install Bun first, then try again. If Bun works in your terminal, restart OpenPets after updating your shell or login PATH." };
  }

  const target = getCliShimTarget({ platform, env, homeDir: options.homeDir });
  await mkdir(target.binDir, { recursive: true });
  const existing = await classifyExistingCliPath(target.path, platform);
  if (existing.status === "conflict") return { code: "conflict", message: existing.reason, path: target.path };

  const body = getCliShimBody(platform);
  if (existing.status === "missing") {
    await writeFile(target.path, body, { flag: "wx", mode: platform === "win32" ? 0o666 : 0o755 });
    return { status: "installed", path: target.path, pathOnPath: target.pathOnPath, shadowedBy: findShadowingOpenPetsCommand(target.path, env, platform) };
  }

  if (existing.body === body) {
    return { status: "already-installed", path: target.path, pathOnPath: target.pathOnPath, shadowedBy: findShadowingOpenPetsCommand(target.path, env, platform) };
  }

  const tempPath = `${target.path}.tmp-${process.pid}-${options.now ?? Date.now()}`;
  await writeFile(tempPath, body, { flag: "wx", mode: platform === "win32" ? 0o666 : 0o755 });
  const beforeRename = await classifyExistingCliPath(target.path, platform);
  if (beforeRename.status !== "managed") {
    await rm(tempPath, { force: true });
    return { code: "conflict", message: `The CLI target changed before update: ${target.path}`, path: target.path };
  }
  await rename(tempPath, target.path);
  return { status: "updated", path: target.path, pathOnPath: target.pathOnPath, shadowedBy: findShadowingOpenPetsCommand(target.path, env, platform) };
}

export async function classifyExistingCliPath(path: string, platform: NodeJS.Platform): Promise<
  | { status: "missing" }
  | { status: "managed"; body: string }
  | { status: "conflict"; reason: string }
> {
  const entry = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!entry) return { status: "missing" };
  if (entry.isSymbolicLink()) return { status: "conflict", reason: `Refusing to replace symlink at ${path}.` };
  if (!entry.isFile()) return { status: "conflict", reason: `Refusing to replace non-file at ${path}.` };
  if (entry.size > MAX_EXISTING_SHIM_BYTES) return { status: "conflict", reason: `Refusing to read unusually large command file at ${path}.` };
  const body = await readFile(path, "utf8");
  if (getKnownCliShimBodies(platform).includes(body)) return { status: "managed", body };
  return { status: "conflict", reason: `A non-OpenPets command already exists at ${path}.` };
}

export function getCliShimTarget(options: { platform: NodeJS.Platform; env: NodeJS.ProcessEnv; homeDir: string }) {
  if (options.platform === "win32") {
    const binDir = join(options.env.LOCALAPPDATA ?? join(options.homeDir, "AppData", "Local"), "OpenPets", "bin");
    return { binDir, path: join(binDir, "openpets.cmd"), pathOnPath: pathContainsDirectory(getPathEnv(options.env), binDir, options.platform) };
  }
  const localBin = join(options.homeDir, ".local", "bin");
  const homeBin = join(options.homeDir, "bin");
  const pathValue = getPathEnv(options.env);
  const binDir = pathContainsDirectory(pathValue, localBin, options.platform) ? localBin : pathContainsDirectory(pathValue, homeBin, options.platform) ? homeBin : localBin;
  return { binDir, path: join(binDir, "openpets"), pathOnPath: pathContainsDirectory(pathValue, binDir, options.platform) };
}

function getCliShimBody(platform: NodeJS.Platform) {
  return platform === "win32" ? WINDOWS_CLI_SHIM_BODY : POSIX_CLI_SHIM_BODY;
}

function getKnownCliShimBodies(platform: NodeJS.Platform) {
  return [getCliShimBody(platform)];
}

function commandExists(command: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform) {
  if (findCommandInPath(command, env, platform)) return true;
  const lookup = platform === "win32" ? "where" : "which";
  const result = spawnSync(lookup, [command], { stdio: "ignore", env: { ...process.env, ...env, PATH: getPathEnv(env) } });
  return result.status === 0 && !result.error;
}

function findShadowingOpenPetsCommand(targetPath: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform) {
  const targetDir = resolve(dirname(targetPath));
  for (const dir of splitPath(getPathEnv(env), platform)) {
    if (samePath(resolve(dir), targetDir, platform)) return null;
    for (const candidate of getCommandCandidates(dir, "openpets", env, platform)) {
      if (canExecute(candidate, platform)) return candidate;
    }
  }
  return null;
}

function findCommandInPath(command: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform) {
  for (const dir of splitPath(getPathEnv(env), platform)) {
    for (const candidate of getCommandCandidates(dir, command, env, platform)) {
      if (canExecute(candidate, platform)) return candidate;
    }
  }
  return null;
}

function getCommandCandidates(dir: string, command: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform) {
  if (platform !== "win32") return [join(dir, command)];
  const pathext = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const lowerCommand = command.toLowerCase();
  if (pathext.some((ext) => lowerCommand.endsWith(ext.toLowerCase()))) return [join(dir, command)];
  return pathext.map((ext) => join(dir, `${command}${ext.toLowerCase()}`));
}

function canExecute(path: string, platform: NodeJS.Platform) {
  try {
    accessSync(path, platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function pathContainsDirectory(pathValue: string | undefined, directory: string, platform: NodeJS.Platform) {
  const resolvedDirectory = resolve(directory);
  return splitPath(pathValue, platform).some((entry) => samePath(resolve(entry), resolvedDirectory, platform));
}

function getPathEnv(env: NodeJS.ProcessEnv) {
  return env.PATH ?? env.Path ?? env.path;
}

function splitPath(pathValue: string | undefined, platform: NodeJS.Platform) {
  return (pathValue ?? "").split(platform === "win32" ? ";" : ":").filter(Boolean);
}

function samePath(left: string, right: string, platform: NodeJS.Platform) {
  return platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}
