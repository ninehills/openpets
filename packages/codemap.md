# openpets/packages/

Shared packages for the OpenPets ecosystem.

## Responsibility

Contains 5 reusable packages that provide core functionality, client libraries, CLI tools, MCP integration, and pet format support.

## Design

- **Core (`@open-pets/core`)**: Domain logic, state management, IPC protocol - zero dependencies
- **Client (`@open-pets/client`)**: TypeScript IPC client for external communication - depends on core
- **CLI (`@open-pets/cli`)**: Command-line interface - depends on client, core, pet-format-codex
- **MCP (`@open-pets/mcp`)**: Model Context Protocol server for Claude Code - depends on client, core
- **Pet Format Codex (`@open-pets/pet-format-codex`)**: Pet loading and validation - depends on core

## Flow

Dependency order (build sequence):
1. `core` (foundation)
2. `pet-format-codex` (uses core types)
3. `client` (uses core IPC)
4. `mcp` and `cli` (both use client)

## Integration

- **Desktop App**: Uses core and pet-format-codex directly
- **External Tools**: CLI and MCP packages provide standalone executables
- **Published**: All packages published to npm as `@open-pets/*`
