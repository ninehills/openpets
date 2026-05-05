# openpets/apps/desktop/

Electron desktop application - the main OpenPets user interface.

## Responsibility

Provides the visual desktop pet window, system tray integration, and IPC server for external control. Renders animated pets using the Codex/Petdex format.

## Design

- **Process Architecture**: 
  - Main process (`main.ts`): Window management, IPC server, tray, pet lifecycle
  - Preload script (`preload.ts`): Secure bridge between main and renderer
  - Renderer process (`renderer/src/`): React UI with sprite animation
- **Security**: CSP headers, context isolation, sandboxed renderer, no node integration
- **Window**: Frameless, transparent, always-on-top, draggable pet window
- **State Management**: Runtime state + lifecycle leases for multi-client coordination

## Flow

1. **Startup**: Load config → Load installed pets → Start IPC server → Create tray → Create window
2. **Event Handling**: External events (IPC) → Reduce to runtime state → Publish to renderer
3. **Rendering**: Renderer receives pet state → Animates spritesheet → Displays speech bubbles
4. **Interaction**: Pointer events → Drag handling → Window repositioning

## Integration

- **Core**: Uses event system, reducer, lifecycle leases, IPC protocol, config
- **Pet Format**: Loads Codex-format pets (spritesheet + pet.json)
- **Client**: IPC server accepts connections from client package
- **CLI**: Can be launched and controlled via CLI commands
- **MCP**: Accepts control via MCP server through IPC protocol
