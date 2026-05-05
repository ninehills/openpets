# packages/pet-format-codex/src/

Source code for the pet format package.

## Responsibility

Implements pet directory loading, manifest parsing, spritesheet validation, and image header reading.

## Design

- **Loader (`loader.ts`)**: 
  - Main entry: `loadCodexPetDirectory()`
  - Staged validation with detailed error reporting
  - Early exit on critical errors (missing manifest/spritesheet)
  - Warning collection for non-fatal issues
- **Validation (`validation.ts`)**: 
  - `parseManifestJson()`: Safe JSON parsing
  - `sanitizeManifestString()`: Fallback values for missing/invalid fields
  - `derivePetIdFromDirectory()`: Fallback ID from folder name
  - `isPathInside()`: Path traversal prevention
- **Image Header Parsing (`loader.ts`)**: 
  - PNG: Signature + IHDR width/height (big-endian)
  - WebP: RIFF + WEBP + VP8X/VP8L/VP8 chunk parsing
  - No external image libraries needed

## Flow

**Load Pet**:
```
resolve path → stat directory → read pet.json → parse manifest
  → find spritesheet file → read header → validate 1536x1872
  → sanitize strings → return { ok: true, pet, warnings }
```

**Error Case**:
```
any step fails → return { ok: false, issues: [{ code, message }] }
```

## Integration

- **Core**: Imports `codexStates` for animation metadata
- **Desktop**: Used in main.ts for `loadInstalledPets()` and `selectPet()`
- **CLI**: Used in install command for validation before copying
- **External**: Published as `@open-pets/pet-format-codex`
