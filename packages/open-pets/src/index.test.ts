import { describe, it, expect } from "bun:test";
import { resolveZipUrl, DEFAULT_CATALOG_URL } from "./index.ts";

describe("resolveZipUrl", () => {
  const customCatalog = "https://example.com/pets/install.json";

  describe("relative paths", () => {
    it("accepts safe relative /pets/*.zip paths", () => {
      const result = resolveZipUrl("/pets/clawd.zip", DEFAULT_CATALOG_URL);
      expect(result).not.toBeInstanceOf(Error);
      expect(result).toBeInstanceOf(URL);
      expect((result as URL).href).toBe("https://openpets.dev/pets/clawd.zip");
    });

    it("accepts relative paths with custom catalog", () => {
      const result = resolveZipUrl("/pets/test.zip", customCatalog);
      expect(result).not.toBeInstanceOf(Error);
      expect((result as URL).href).toBe("https://example.com/pets/test.zip");
    });

    it("rejects paths not starting with /pets/", () => {
      const result = resolveZipUrl("/other/path.zip", DEFAULT_CATALOG_URL);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("unsafe pet zip path");
    });

    it("rejects paths not ending with .zip", () => {
      const result = resolveZipUrl("/pets/clawd.exe", DEFAULT_CATALOG_URL);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("unsafe pet zip path");
    });

    it("rejects paths with query strings", () => {
      const result = resolveZipUrl("/pets/clawd.zip?foo=bar", DEFAULT_CATALOG_URL);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("unsafe pet zip path");
    });

    it("rejects paths with hash fragments", () => {
      const result = resolveZipUrl("/pets/clawd.zip#section", DEFAULT_CATALOG_URL);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("unsafe pet zip path");
    });

    it("rejects paths with backslashes", () => {
      const result = resolveZipUrl("/pets\\clawd.zip", DEFAULT_CATALOG_URL);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("unsafe pet zip path");
    });

    it("rejects paths with .. traversal", () => {
      const result = resolveZipUrl("/pets/../secret.zip", DEFAULT_CATALOG_URL);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("unsafe pet zip path");
    });

    it("rejects URL-encoded .. traversal", () => {
      const result = resolveZipUrl("/pets/%2e%2e/secret.zip", DEFAULT_CATALOG_URL);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("unsafe pet zip path");
    });
  });

  describe("absolute R2 URLs", () => {
    it("accepts https://zip.openpets.dev/pets/*.zip URLs", () => {
      const result = resolveZipUrl("https://zip.openpets.dev/pets/clawd.zip", DEFAULT_CATALOG_URL);
      expect(result).not.toBeInstanceOf(Error);
      expect(result).toBeInstanceOf(URL);
      expect((result as URL).href).toBe("https://zip.openpets.dev/pets/clawd.zip");
    });

    it("accepts R2 URLs with any catalog", () => {
      const result = resolveZipUrl("https://zip.openpets.dev/pets/test.zip", customCatalog);
      expect(result).not.toBeInstanceOf(Error);
      expect((result as URL).href).toBe("https://zip.openpets.dev/pets/test.zip");
    });

    it("rejects other origins", () => {
      const result = resolveZipUrl("https://evil.com/pets/clawd.zip", DEFAULT_CATALOG_URL);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("unsafe pet zip origin");
    });

    it("rejects http:// (non-HTTPS)", () => {
      const result = resolveZipUrl("http://zip.openpets.dev/pets/clawd.zip", DEFAULT_CATALOG_URL);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("unsafe pet zip path");
    });

    it("rejects non-.zip extensions on absolute URLs", () => {
      const result = resolveZipUrl("https://zip.openpets.dev/pets/clawd.exe", DEFAULT_CATALOG_URL);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("unsafe pet zip path");
    });

    it("rejects absolute URLs not under /pets/", () => {
      const result = resolveZipUrl("https://zip.openpets.dev/other/clawd.zip", DEFAULT_CATALOG_URL);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("unsafe pet zip path");
    });

    it("rejects absolute URLs with query strings", () => {
      const result = resolveZipUrl("https://zip.openpets.dev/pets/clawd.zip?foo=bar", DEFAULT_CATALOG_URL);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("unsafe pet zip path");
    });

    it("rejects absolute URLs with hash fragments", () => {
      const result = resolveZipUrl("https://zip.openpets.dev/pets/clawd.zip#section", DEFAULT_CATALOG_URL);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("unsafe pet zip path");
    });

    it("rejects absolute URLs with backslashes", () => {
      const result = resolveZipUrl("https://zip.openpets.dev/pets\\clawd.zip", DEFAULT_CATALOG_URL);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("unsafe pet zip path");
    });

    it("rejects absolute URLs with .. traversal", () => {
      const result = resolveZipUrl("https://zip.openpets.dev/pets/../secret.zip", DEFAULT_CATALOG_URL);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("unsafe pet zip path");
    });

    it("rejects URL-encoded .. traversal in absolute URLs", () => {
      const result = resolveZipUrl("https://zip.openpets.dev/pets/%2e%2e/secret.zip", DEFAULT_CATALOG_URL);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("unsafe pet zip path");
    });

    it("rejects malformed absolute URLs", () => {
      const result = resolveZipUrl("https://[invalid", DEFAULT_CATALOG_URL);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("unsafe pet zip path");
    });
  });

  describe("edge cases", () => {
    it("rejects empty string", () => {
      const result = resolveZipUrl("", DEFAULT_CATALOG_URL);
      expect(result).toBeInstanceOf(Error);
    });

    it("rejects paths with only extension", () => {
      const result = resolveZipUrl(".zip", DEFAULT_CATALOG_URL);
      expect(result).toBeInstanceOf(Error);
    });

    it("accepts paths with hyphens in filename", () => {
      const result = resolveZipUrl("/pets/my-pet-name.zip", DEFAULT_CATALOG_URL);
      expect(result).not.toBeInstanceOf(Error);
      expect((result as URL).href).toBe("https://openpets.dev/pets/my-pet-name.zip");
    });

    it("accepts R2 URLs with hyphens in filename", () => {
      const result = resolveZipUrl("https://zip.openpets.dev/pets/my-pet-name.zip", DEFAULT_CATALOG_URL);
      expect(result).not.toBeInstanceOf(Error);
      expect((result as URL).href).toBe("https://zip.openpets.dev/pets/my-pet-name.zip");
    });
  });
});
