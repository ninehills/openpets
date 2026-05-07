# openpets/packages/open-pets/

Clean one-command pet installs for OpenPets.

## Responsibility

Provides the `install-pet` CLI command - a simple, user-friendly way to install pets from the OpenPets catalog. Fetches the install catalog, validates the requested pet ID, downloads the pet zip, and installs/activates it.

## Design

- **Single command**: `install-pet <pet-id>` - minimal friction for users
- **Catalog-based**: Fetches install catalog from `https://openpets.dev/pets/install.json` (configurable via `--catalog`)
- **Security validation**: Strict URL validation for both catalog and zip URLs, enforces HTTPS-only, validates pet IDs against safe pattern
- **R2 zip support**: Supports `https://zip.openpets.dev/pets/*.zip` URLs with origin/path validation
- **User feedback**: Clear progress messages and activation status (immediate activation vs restart required)

## Flow

1. `main(argv)` - Parse arguments, extract pet ID
2. `fetchInstallCatalog()` - Download and validate catalog JSON
3. Find pet by `installId` in catalog
4. `resolveZipUrl()` - Validate and resolve zip URL (supports absolute R2 URLs or relative paths)
5. `installAndActivatePet()` - Delegate to `@open-pets/installer` for actual installation
6. Report success/activation status to user

## Integration

- **Depends on**: `@open-pets/installer` (all installation logic)
- **CLI binary**: `install-pet` (defined in `package.json` bin field)
- **Catalog source**: `https://openpets.dev/pets/install.json` (default)
- **Published**: `install-pet` package on npm (unscoped name for easy `bunx install-pet` usage)
