import { describe, it, expect } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

// CLI package directory
const CLI_DIR = resolve(import.meta.dir, "..");
const WORKSPACE_ROOT = resolve(import.meta.dir, "../../..");

async function runCli(args: string[], cwd: string = CLI_DIR) {
  // Run from CLI package directory so workspace deps resolve
  const proc = Bun.spawn({
    cmd: ["bun", "run", "./src/index.ts", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  return { exitCode, stdout, stderr };
}

describe("CLI black-box tests", () => {
  it("points integration users to dedicated packages", async () => {
    const result = await runCli(["help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("bunx claude-pets install");
    expect(result.stdout).toContain("bunx opencode-pets install");
    expect(result.stdout).not.toContain("openpets hook claude-code");
  });

  it("does not expose legacy integration commands", async () => {
    const hookResult = await runCli(["hook", "claude-code"]);
    const integrateResult = await runCli(["integrate", "claude-code"]);

    expect(hookResult.exitCode).toBe(1);
    expect(hookResult.stderr).toContain("Unknown command: hook");
    expect(integrateResult.exitCode).toBe(1);
    expect(integrateResult.stderr).toContain("Unknown command: integrate");
  });

  describe("start command with invalid pet paths", () => {
    it("returns non-zero exit code for non-existent pet path with clear stderr", async () => {
      const result = await runCli(["start", "--pet", "./does-not-exist"]);

      expect(result.exitCode).not.toBe(0);
      // Error should mention directory requirement
      expect(result.stderr.toLowerCase()).toMatch(/directory|not.*exist|invalid/);
    });

    it("returns non-zero exit code for .zip file path with clear stderr", async () => {
      // Create a temporary zip file
      const tempDir = await mkdtemp(join(tmpdir(), "openpets-test-"));
      const zipPath = join(tempDir, "pet.zip");
      await writeFile(zipPath, "PK"); // Minimal zip header

      const result = await runCli(["start", "--pet", zipPath]);

      expect(result.exitCode).not.toBe(0);
      // Error should mention zip not being supported
      expect(result.stderr.toLowerCase()).toContain("zip");
    });
  });
});
