# openpets/

Monorepo root for OpenPets - a desktop pet application for Claude Code and coding agents.

## Responsibility

Root workspace coordinating multiple packages and apps through Bun workspaces. Defines build orchestration, testing, and packaging scripts for the entire system.

## Design

- **Workspace Structure**: Uses Bun workspaces with `apps/*` and `packages/*` patterns
- **Build Pipeline**: Sequential package builds (core → pet-format-codex → client → mcp → cli) before desktop
- **Package Management**: All packages use TypeScript with ES modules (`"type": "module"`)
- **Distribution**: Electron Builder for cross-platform desktop packaging (macOS, Windows, Linux)

## Flow

1. `bun install` installs all workspace dependencies
2. `bun run build:packages` builds shared packages in dependency order
3. `bun run build` builds desktop app with all dependencies
4. `bun run package:*` creates platform-specific installers

## Integration

- **Internal**: Coordinates 5 packages and 1 desktop app through workspace references
- **External**: Publishes to npm registry as `@open-pets/*` scoped packages
- **Desktop**: Electron-based desktop app consumes all packages
