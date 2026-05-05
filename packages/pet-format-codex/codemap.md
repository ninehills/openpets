# openpets/packages/pet-format-codex/

Codex/Petdex pet format loader and validator.

## Responsibility

Loads and validates pet packages in the Codex/Petdex format: directories containing `pet.json` manifest and `spritesheet.webp/png` animation spritesheet.

## Design

- **Format Support**: 
  - `pet.json`: Manifest with id, displayName, description
  - `spritesheet.webp` or `spritesheet.png`: 1536x1872px sprite sheet
  - 9 animation rows (idle, running-right, running-left, waving, jumping, failed, waiting, running, review)
  - 8 columns, 192x208px frames
- **Validation (`validation.ts`)**: 
  - Directory existence check
  - JSON parsing with error handling
  - String sanitization for manifest fields
  - Path safety utilities
- **Loading (`loader.ts`)**: 
  - `loadCodexPetDirectory()` async function
  - Dimension validation from image headers (no full decode)
  - PNG: IHDR chunk parsing
  - WebP: RIFF/VP8X/VP8L/VP8 header parsing
- **Types (`types.ts`)**: 
  - `CodexPetManifest`, `LoadedCodexPet`, `LoadCodexPetResult`
  - Validation issue types with error codes

## Flow

```
Directory path → stat() → find pet.json → parse manifest 
  → find spritesheet → validate dimensions → return LoadedCodexPet
```

## Integration

- **Core**: Uses `CodexState` type and `codexStates` array from `@open-pets/core`
- **Desktop**: Main process uses to load active pet and installed pets list
- **CLI**: Uses for pet validation during install command
- **Format**: Compatible with Codex/Petdex pet ecosystem
