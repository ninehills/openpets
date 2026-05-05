# openpets/packages/cli/

Command-line interface for OpenPets.

## Responsibility

Provides standalone CLI commands for launching the desktop app, sending events, installing pets, and controlling the window. Published as `openpets` on npm.

## Design

- **Entry Point (`index.ts`)**: 
  - Command router: start, event, install, show, hide, sleep, quit, help
  - Direct process exit codes (0 = success, 1 = error)
- **Commands**:
  - `start [--pet <path>] [--scale <n>] [--debug]`: Launch desktop app
  - `event <state> [--message <text>]`: Send state event to running pet
  - `install <source>`: Install pet from zip URL, local zip, or folder
  - `show|hide|sleep|quit`: Window control commands
- **Pet Installation**: 
  - Supports HTTPS zip URLs, local zip files, or directories
  - Staging with temp directory → validation → hash-based naming
  - Auto-activation if desktop is running with pet-v1 capability
  - Security: Path traversal prevention, size limits (50MB zip, 100MB extracted, 300 files max)
- **Desktop Launching**: 
  - Dev mode: Spawns `bunx electron` from source
  - Production: Requires installed desktop app

## Flow

1. **Start Command**: 
   - Check if running → Launch if needed → Wait for health (5s timeout)
   - Apply CLI args (--pet, --scale) via desktop argv
2. **Event Command**: 
   - Validate state → `sendEvent()` → Exit with appropriate code
3. **Install Command**: 
   - Stage source → Find pet.json → Validate → Copy to pets dir → Activate

## Integration

- **Client**: Uses `@open-pets/client` for all IPC communication
- **Core**: Uses state validation and config utilities
- **Pet Format**: Uses `@open-pets/pet-format-codex` for pet validation
- **Desktop**: Can launch and control the desktop application
