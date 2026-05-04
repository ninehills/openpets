import { stat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { codexStates } from "@openpets/core";
import type { CodexPetManifest, LoadCodexPetResult, PetValidationIssue } from "./types";
import { derivePetIdFromDirectory, parseManifestJson, sanitizeManifestString } from "./validation";

const spritesheetFileNames = ["spritesheet.webp", "spritesheet.png"] as const;
const expectedSpritesheet = { width: 1536, height: 1872 } as const;

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function issue(code: PetValidationIssue["code"], message: string): PetValidationIssue {
  return { code, message };
}

export async function loadCodexPetDirectory(directory: string): Promise<LoadCodexPetResult> {
  const resolvedDirectory = resolve(directory);

  const directoryStat = await stat(resolvedDirectory).catch(() => null);
  if (!directoryStat?.isDirectory()) {
    return {
      ok: false,
      issues: [issue("not-directory", "Pet path must be a local directory")],
    };
  }

  const manifestPath = join(resolvedDirectory, "pet.json");
  if (!(await exists(manifestPath))) {
    return {
      ok: false,
      issues: [issue("missing-manifest", "Missing pet.json")],
    };
  }

  let manifest: CodexPetManifest;
  try {
    const contents = await readFile(manifestPath, "utf8");
    const parsed = parseManifestJson(contents);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        issues: [issue("invalid-manifest", "pet.json must be a JSON object")],
      };
    }
    manifest = parsed as CodexPetManifest;
  } catch (error) {
    return {
      ok: false,
      issues: [
        issue(
          "invalid-manifest",
          error instanceof Error ? error.message : "Could not parse pet.json",
        ),
      ],
    };
  }

  const spritesheetFileName = await findSpritesheetFileName(resolvedDirectory);
  if (!spritesheetFileName) {
    return {
      ok: false,
      issues: [issue("missing-spritesheet", "Missing spritesheet.webp or spritesheet.png")],
    };
  }

  const spritesheetPath = join(resolvedDirectory, spritesheetFileName);
  const dimensionIssue = await validateSpritesheetDimensions(spritesheetPath, spritesheetFileName);
  if (dimensionIssue) {
    return { ok: false, issues: [dimensionIssue] };
  }

  const fallbackId = derivePetIdFromDirectory(resolvedDirectory);
  const id = sanitizeManifestString(manifest.id, fallbackId);
  const displayName = sanitizeManifestString(manifest.displayName, id);
  const description = sanitizeManifestString(
    manifest.description,
    "A Codex-compatible digital pet.",
  );

  return {
    ok: true,
    warnings: [],
    pet: {
      directory: resolvedDirectory,
      id,
      displayName,
      description,
      manifestPath,
      spritesheetPath,
      spritesheetFileName,
      states: codexStates,
    },
  };
}

async function findSpritesheetFileName(directory: string) {
  for (const fileName of spritesheetFileNames) {
    if (await exists(join(directory, fileName))) {
      return fileName;
    }
  }
  return null;
}

async function validateSpritesheetDimensions(
  path: string,
  fileName: "spritesheet.webp" | "spritesheet.png",
) {
  const bytes = await readFile(path);
  const dimensions = fileName.endsWith(".png") ? pngDimensions(bytes) : webpDimensions(bytes);
  if (!dimensions) {
    return issue("invalid-spritesheet", `Could not read dimensions from ${fileName}`);
  }
  if (dimensions.width !== expectedSpritesheet.width || dimensions.height !== expectedSpritesheet.height) {
    return issue(
      "invalid-spritesheet-dimensions",
      `${fileName} must be ${expectedSpritesheet.width}x${expectedSpritesheet.height}; got ${dimensions.width}x${dimensions.height}`,
    );
  }
  return null;
}

function pngDimensions(bytes: Buffer) {
  const signature = bytes.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a" || bytes.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function webpDimensions(bytes: Buffer) {
  if (bytes.subarray(0, 4).toString("ascii") !== "RIFF" || bytes.subarray(8, 12).toString("ascii") !== "WEBP") return null;
  const chunk = bytes.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X") {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    };
  }
  if (chunk === "VP8L") {
    if (bytes.length < 25) return null;
    const b0 = bytes[21]!;
    const b1 = bytes[22]!;
    const b2 = bytes[23]!;
    const b3 = bytes[24]!;
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  if (chunk === "VP8 ") {
    const payloadOffset = 20;
    if (bytes.length < payloadOffset + 10) return null;
    if (
      bytes[payloadOffset + 3] !== 0x9d ||
      bytes[payloadOffset + 4] !== 0x01 ||
      bytes[payloadOffset + 5] !== 0x2a
    ) {
      return null;
    }
    return {
      width: bytes.readUInt16LE(payloadOffset + 6) & 0x3fff,
      height: bytes.readUInt16LE(payloadOffset + 8) & 0x3fff,
    };
  }
  return null;
}
