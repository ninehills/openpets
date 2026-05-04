import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { loadCodexPetDirectory } from "./loader";

async function createPetFixture(files: Record<string, string | Buffer>) {
  const directory = await mkdtemp(join(tmpdir(), "openpets-codex-pet-"));
  for (const [fileName, contents] of Object.entries(files)) {
    await writeFile(join(directory, fileName), contents);
  }
  return directory;
}

function pngWithDimensions(width = 1536, height = 1872) {
  const bytes = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes, 0);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

// WebP VP8 lossy format (simple keyframe header)
// Creates a minimal VP8 lossy WebP with specified dimensions
// Based on WebP container spec: RIFF + filesize + WEBP + VP8 chunk + size + VP8 bitstream
function webpVP8WithDimensions(width = 1536, height = 1872) {
  // RIFF header (bytes 0-3)
  const riffHeader = Buffer.from("RIFF", "ascii");
  // File size placeholder (bytes 4-7) - will be calculated later
  const fileSize = Buffer.alloc(4);
  // WEBP signature (bytes 8-11)
  const webpSignature = Buffer.from("WEBP", "ascii");
  
  // VP8 chunk header (bytes 12-15)
  const vp8Chunk = Buffer.from("VP8 ", "ascii");
  // VP8 chunk size (bytes 16-19)
  const vp8ChunkSize = Buffer.alloc(4);
  
  // VP8 bitstream data starts at byte 20
  // VP8 keyframe header structure (per loader.ts webpDimensions):
  // bytes 20-22: frame tag (3 bytes)
  // byte 23 (offset 3): must be 0x9d (keyframe marker byte 0)
  // byte 24 (offset 4): must be 0x01 (keyframe marker byte 1)  
  // byte 25 (offset 5): must be 0x2a (keyframe marker byte 2)
  // bytes 26-27 (offset 6-7): width (14 bits) in little-endian
  // bytes 28-29 (offset 8-9): height (14 bits) in little-endian
  const vp8Data = Buffer.alloc(10);
  
  // Frame tag (simple keyframe start code)
  vp8Data[0] = 0x10; // Frame tag byte 0
  vp8Data[1] = 0x00; // Frame tag byte 1
  vp8Data[2] = 0x00; // Frame tag byte 2
  
  // Keyframe marker bytes (checked by loader.ts at offset 3, 4, 5 from VP8 data start)
  vp8Data[3] = 0x9d;
  vp8Data[4] = 0x01;
  vp8Data[5] = 0x2a;
  
  // Width: 14 bits stored in little-endian at offset 6
  vp8Data.writeUInt16LE(width & 0x3fff, 6);
  // Height: 14 bits stored in little-endian at offset 8
  vp8Data.writeUInt16LE(height & 0x3fff, 8);
  
  // Set VP8 chunk size (just the VP8 data, not including chunk header/size)
  vp8ChunkSize.writeUInt32LE(vp8Data.length, 0);
  
  // Calculate total file size for RIFF header
  // RIFF size = total file size - 8 (RIFF header and size field not counted)
  const totalSize = 4 + 4 + 4 + 4 + 4 + vp8Data.length;
  fileSize.writeUInt32LE(totalSize - 8, 0);
  
  return Buffer.concat([riffHeader, fileSize, webpSignature, vp8Chunk, vp8ChunkSize, vp8Data]);
}

describe("Codex pet directory loader", () => {
  test("loads a valid pet directory", async () => {
    const directory = await createPetFixture({
      "pet.json": JSON.stringify({
        id: "boba",
        displayName: "Boba",
        description: "A tiny otter.",
      }),
      "spritesheet.png": pngWithDimensions(),
    });

    const result = await loadCodexPetDirectory(directory);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pet.id).toBe("boba");
      expect(result.pet.displayName).toBe("Boba");
      expect(result.pet.spritesheetFileName).toBe("spritesheet.png");
      expect(result.pet.states.length).toBe(9);
    }
  });

  test("falls back to directory name and default description", async () => {
    const directory = await createPetFixture({
      "pet.json": JSON.stringify({}),
      "spritesheet.png": pngWithDimensions(),
    });

    const result = await loadCodexPetDirectory(directory);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pet.id).toMatch(/^openpets-codex-pet-/);
      expect(result.pet.description).toBe("A Codex-compatible digital pet.");
      expect(result.pet.spritesheetFileName).toBe("spritesheet.png");
    }
  });

  test("rejects missing manifest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openpets-codex-pet-"));
    const result = await loadCodexPetDirectory(directory);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe("missing-manifest");
    }
  });

  test("rejects non-directories", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openpets-codex-pet-"));
    const filePath = join(directory, "file.txt");
    await writeFile(filePath, "x");

    const result = await loadCodexPetDirectory(filePath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe("not-directory");
    }
  });

  test("rejects missing spritesheet", async () => {
    const directory = await createPetFixture({
      "pet.json": JSON.stringify({ id: "no-sprite" }),
    });

    const result = await loadCodexPetDirectory(directory);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe("missing-spritesheet");
    }
  });

  test("rejects invalid spritesheet dimensions", async () => {
    const directory = await createPetFixture({
      "pet.json": JSON.stringify({ id: "bad-size" }),
      "spritesheet.png": pngWithDimensions(100, 100),
    });

    const result = await loadCodexPetDirectory(directory);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe("invalid-spritesheet-dimensions");
    }
  });

  describe("WebP VP8 lossy spritesheet", () => {
    test("accepts valid 1536x1872 VP8 WebP", async () => {
      const directory = await createPetFixture({
        "pet.json": JSON.stringify({
          id: "webp-vp8-pet",
          displayName: "VP8 Pet",
        }),
        "spritesheet.webp": webpVP8WithDimensions(1536, 1872),
      });

      const result = await loadCodexPetDirectory(directory);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.pet.spritesheetFileName).toBe("spritesheet.webp");
      }
    });

    test("rejects VP8 WebP with wrong dimensions", async () => {
      const directory = await createPetFixture({
        "pet.json": JSON.stringify({ id: "bad-webp-size" }),
        "spritesheet.webp": webpVP8WithDimensions(100, 100),
      });

      const result = await loadCodexPetDirectory(directory);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues[0]?.code).toBe("invalid-spritesheet-dimensions");
        expect(result.issues[0]?.message).toContain("100x100");
      }
    });

    test("rejects VP8 WebP with non-standard dimensions", async () => {
      const directory = await createPetFixture({
        "pet.json": JSON.stringify({ id: "wrong-webp-dims" }),
        "spritesheet.webp": webpVP8WithDimensions(1024, 1024),
      });

      const result = await loadCodexPetDirectory(directory);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues[0]?.code).toBe("invalid-spritesheet-dimensions");
      }
    });
  });
});
