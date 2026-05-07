import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { POSIX_CLI_SHIM_BODY, classifyExistingCliPath, getCliShimTarget, installCliShim } from "./cli-shim.js";

describe("getCliShimTarget", () => {
  test("prefers ~/.local/bin when it is on PATH", () => {
    const homeDir = "/Users/test";
    const target = getCliShimTarget({ platform: "darwin", homeDir, env: { PATH: `/usr/bin:${homeDir}/.local/bin:${homeDir}/bin` } });
    expect(target.path).toBe(`${homeDir}/.local/bin/openpets`);
    expect(target.pathOnPath).toBe(true);
  });

  test("falls back to ~/.local/bin when no user bin is on PATH", () => {
    const homeDir = "/home/test";
    const target = getCliShimTarget({ platform: "linux", homeDir, env: { PATH: "/usr/bin" } });
    expect(target.path).toBe(`${homeDir}/.local/bin/openpets`);
    expect(target.pathOnPath).toBe(false);
  });

  test("uses Windows Path env case-insensitively", () => {
    const homeDir = "C:/Users/test";
    const binDir = "C:/Users/test/AppData/Local/OpenPets/bin";
    const target = getCliShimTarget({ platform: "win32", homeDir, env: { Path: `C:/Windows/System32;${binDir.toLowerCase()}` } });
    expect(target.pathOnPath).toBe(true);
    expect(target.path.endsWith("openpets.cmd")).toBe(true);
  });
});

describe("classifyExistingCliPath", () => {
  test("reports missing targets", async () => {
    const dir = await tempDir();
    expect(await classifyExistingCliPath(join(dir, "openpets"), "linux")).toEqual({ status: "missing" });
  });

  test("accepts exact managed shim body", async () => {
    const dir = await tempDir();
    const target = join(dir, "openpets");
    await writeFile(target, POSIX_CLI_SHIM_BODY);
    expect(await classifyExistingCliPath(target, "linux")).toEqual({ status: "managed", body: POSIX_CLI_SHIM_BODY });
  });

  test("rejects conflicting regular files", async () => {
    const dir = await tempDir();
    const target = join(dir, "openpets");
    await writeFile(target, "#!/bin/sh\necho not openpets\n");
    expect(await classifyExistingCliPath(target, "linux")).toMatchObject({ status: "conflict" });
  });

  test("rejects directories", async () => {
    const dir = await tempDir();
    const target = join(dir, "openpets");
    await mkdir(target);
    expect(await classifyExistingCliPath(target, "linux")).toMatchObject({ status: "conflict" });
  });

  test("rejects symlinks", async () => {
    const dir = await tempDir();
    const target = join(dir, "openpets");
    const linked = join(dir, "linked-openpets");
    await writeFile(linked, POSIX_CLI_SHIM_BODY);
    await symlink(linked, target);
    expect(await classifyExistingCliPath(target, "linux")).toMatchObject({ status: "conflict" });
  });
});

describe("installCliShim", () => {
  test("blocks when bunx is missing", async () => {
    const homeDir = await tempDir();
    const result = await installCliShim({ platform: "linux", homeDir, env: { PATH: homeDir } });
    expect(result).toMatchObject({ code: "bunx-missing" });
  });

  test("installs a new shim when bunx is available", async () => {
    const homeDir = await tempDir();
    const binDir = join(homeDir, ".local", "bin");
    const fakeBunDir = await tempDir();
    const fakeBunx = join(fakeBunDir, "bunx");
    await writeFile(fakeBunx, "#!/bin/sh\nexit 0\n");
    await chmod(fakeBunx, 0o755);

    const result = await installCliShim({ platform: "linux", homeDir, env: { PATH: `${fakeBunDir}:${binDir}` } });
    expect(result).toMatchObject({ status: "installed", pathOnPath: true, shadowedBy: null });
    expect(await readFile(join(binDir, "openpets"), "utf8")).toBe(POSIX_CLI_SHIM_BODY);
  });

  test("refuses to overwrite a conflicting target", async () => {
    const homeDir = await tempDir();
    const binDir = join(homeDir, ".local", "bin");
    const fakeBunDir = await tempDir();
    await mkdir(binDir, { recursive: true });
    await writeFile(join(binDir, "openpets"), "not openpets");
    const fakeBunx = join(fakeBunDir, "bunx");
    await writeFile(fakeBunx, "#!/bin/sh\nexit 0\n");
    await chmod(fakeBunx, 0o755);

    const result = await installCliShim({ platform: "linux", homeDir, env: { PATH: `${fakeBunDir}:${binDir}` } });
    expect(result).toMatchObject({ code: "conflict" });
    expect(await readFile(join(binDir, "openpets"), "utf8")).toBe("not openpets");
  });

  test("detects an already installed shim", async () => {
    const homeDir = await tempDir();
    const binDir = join(homeDir, ".local", "bin");
    const fakeBunDir = await tempDir();
    await mkdir(binDir, { recursive: true });
    await writeFile(join(binDir, "openpets"), POSIX_CLI_SHIM_BODY);
    const fakeBunx = join(fakeBunDir, "bunx");
    await writeFile(fakeBunx, "#!/bin/sh\nexit 0\n");
    await chmod(fakeBunx, 0o755);

    const result = await installCliShim({ platform: "linux", homeDir, env: { PATH: `${fakeBunDir}:${binDir}` } });
    expect(result).toMatchObject({ status: "already-installed" });
  });
});

async function tempDir() {
  return mkdtemp(join(tmpdir(), "openpets-cli-shim-"));
}
