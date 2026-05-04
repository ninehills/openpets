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
