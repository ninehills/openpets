# openpets/packages/installer/

Shared OpenPets pet installation logic.

## Responsibility

Provides reusable pet installation functionality for downloading, validating, extracting, and installing OpenPets from various sources (HTTPS URLs, local zip files, or local directories). Handles activation coordination with a running OpenPets desktop app or falls back to config-based activation.

## Design

- **Multi-source support**: Accepts HTTPS zip URLs, local `.zip` files, or local pet directories
- **Security-first**: Validates zip contents (path traversal prevention, size limits, file count limits), enforces HTTPS-only downloads, optional same-origin redirect enforcement
- **Staging workflow**: Extracts to temp staging directory, validates pet format, then atomically moves to final destination with content-hash suffix
- **Live activation**: Attempts to activate pet immediately if OpenPets is running with `pet-v1` capability; falls back to writing config for next launch
- **Resource limits**: 50MB max zip size, 100MB max extracted size, 300 max files, 30s download timeout

## Flow

1. `installAndActivatePet(source, options)` - Main entry point
2. `stagePetSource()` - Downloads or copies source to temp staging
3. `findCandidatePetDirs()` - Walks staging to find directories containing `pet.json`
4. `loadCodexPetDirectory()` - Validates pet format using `@open-pets/pet-format-codex`
5. `copyDirectory()` - Copies validated pet to temp final location
6. Atomic rename to final destination with hash suffix
7. If OpenPets running: call `selectOpenPetsPet()` to activate; else: write config

## Integration

- **Depends on**: `@open-pets/client` (health check, pet selection), `@open-pets/core/config` (config paths), `@open-pets/pet-format-codex` (pet validation), `jszip` (zip extraction)
- **Used by**: `install-pet` CLI (`@open-pets/open-pets` package), `@open-pets/cli` package
- **Published**: `@open-pets/installer` on npm
