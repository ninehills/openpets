# openpets/packages/

Shared packages for the OpenPets ecosystem.

## Responsibility

Contains 7 reusable packages that provide core functionality, client libraries, CLI tools, MCP integration, pet format support, installation logic, and the one-command pet installer.

## Design

- **Core (`@open-pets/core`)**: Domain logic, state management, IPC protocol - zero dependencies
- **Client (`@open-pets/client`)**: TypeScript IPC client for external communication - depends on core
- **Pet Format Codex (`@open-pets/pet-format-codex`)**: Pet loading and validation - depends on core
- **Installer (`@open-pets/installer`)**: Shared pet installation logic (download, extract, validate, activate) - depends on client, core, pet-format-codex
- **CLI (`@open-pets/cli`)**: Command-line interface - depends on client, core, pet-format-codex, installer
- **MCP (`@open-pets/mcp`)**: Model Context Protocol server for Claude Code - depends on client, core
- **Open Pets (`install-pet`)**: One-command pet installer CLI - depends on installer

## Flow

Dependency order (build sequence):
1. `core` (foundation)
2. `pet-format-codex` (uses core types)
3. `client` (uses core IPC)
4. `installer` (uses client, pet-format-codex)
5. `mcp`, `cli`, `open-pets` (all use client; cli and open-pets use installer)

## Integration

- **Desktop App**: Uses core and pet-format-codex directly
- **External Tools**: CLI, MCP, and install-pet packages provide standalone executables
- **Published**: All packages published to npm as `@open-pets/*` (except `install-pet` which is unscoped)
