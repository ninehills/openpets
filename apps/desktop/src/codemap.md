# apps/desktop/src/

Main process source code for the Electron desktop app.

## Responsibility

Implements the Electron main process: window management, IPC server, system tray, pet loading, and state coordination between external clients and the renderer.

## Design

- **Main (`main.ts`)**: 
  - Single-instance lock enforcement
  - Window lifecycle (create, show, hide, position, scale)
  - IPC handler registration
  - Tray menu with dynamic pet selection
  - Config persistence (position, scale, selected pet)
  - Lease-based multi-client coordination
- **IPC Server (`ipc-server.ts`)**: 
  - Unix domain sockets (macOS/Linux) or named pipes (Windows)
  - Safety checks for socket path security
  - Request/response protocol over newline-delimited JSON
- **Preload (`preload.ts`)**: 
  - Exposes controlled API to renderer via `contextBridge`
  - Type-safe IPC channels for state updates and interactions

## Flow

1. **App Ready**: 
   - Hide dock icon (macOS) → Install security headers → Load config
   - Load installed pets from pets directory → Start IPC server
   - Create system tray → Create pet window
2. **State Updates**: 
   - External event received → `reducePetEvent()` → `publishState()`
   - `publishState()` resizes window → sends to renderer via `pet-state` channel
3. **Window Actions**: 
   - Tray click or IPC command → `handleWindowAction()` → Update config → Show/hide window

## Integration

- **Core Packages**: Heavy use of `@open-pets/core` for events, reducer, leases, IPC
- **Pet Format**: Uses `@open-pets/pet-format-codex` to load pet directories
- **Renderer**: Sends state via `ipcMain`, receives actions via `ipcRenderer`
- **External Clients**: IPC server accepts connections from CLI, MCP, any client using `@open-pets/client`
