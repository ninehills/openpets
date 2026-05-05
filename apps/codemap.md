# openpets/apps/

Application layer containing the desktop Electron app.

## Responsibility

Houses end-user applications. Currently contains only the desktop pet application.

## Design

- **Single App**: Only the desktop app resides here (web app excluded per requirements)
- **Electron Architecture**: Main process (Node) + Renderer process (Chromium)
- **Build Output**: Packaged apps for macOS (.dmg), Windows (.exe), Linux (.AppImage/.deb)

## Flow

1. Desktop app is the primary user interface
2. Communicates with packages via IPC for all pet control operations
3. Renders React-based UI in the renderer process

## Integration

- **Packages**: Consumes `@open-pets/core`, `@open-pets/pet-format-codex` directly
- **CLI**: Can be launched via CLI `openpets start` command
- **MCP**: Accepts control commands from MCP server through IPC
