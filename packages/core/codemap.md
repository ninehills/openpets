# openpets/packages/core/

Core domain logic, state management, and IPC protocol definitions.

## Responsibility

Provides the foundational types, state machine, event system, lifecycle management, and IPC protocol used by all other packages. Zero external dependencies.

## Design

- **State System (`states.ts`)**: 
  - 13 pet states: idle, thinking, working, editing, running, testing, waiting, waving, success, error, warning, celebrating, sleeping
  - Categorization: long-running vs temporary states
  - Priority system for state precedence (error > warning > celebrating > ...)
- **Event System (`event.ts`)**: 
  - `OpenPetsEvent` type with validation
  - Size limits: 16KB max, 240 char messages
  - Factory for manual events with defaults
- **Reducer (`reducer.ts`)**: 
  - Pure function `reducePetEvent()` computes next state
  - Handles temporary state expiration (success/error/warning/celebrating auto-revert)
  - Duplicate debouncing (250ms)
- **Lifecycle (`lifecycle.ts`)**: 
  - Lease-based multi-client coordination
  - Clients: mcp, opencode, cli
  - Heartbeat mechanism with TTL (30s - 600s)
  - Auto-close leases for MCP clients
- **IPC Protocol (`ipc.ts`)**: 
  - Protocol version 2, newline-delimited JSON
  - Methods: health, event, window, lease, pet
  - Unix sockets (macOS/Linux) or named pipes (Windows)
  - Security: path validation, ownership checks, symlink prevention
- **Config (`config.ts`)**: 
  - Platform-specific config directories
  - JSON-based persistence
- **Codex Mapping (`codex-mapping.ts`)**: 
  - Maps OpenPets states to Codex animation states
  - 9 animation rows with frame counts and durations

## Flow

1. **Event In**: `validateOpenPetsEvent()` → `reducePetEvent()` → `PetRuntimeState`
2. **Lifecycle**: `validateLeaseParams()` → `applyLeaseAction()` → `LeaseResult`
3. **IPC**: `validateIpcRequest()` → `dispatchIpcRequest()` → `IpcResponse`

## Integration

- **Consumed by**: All other packages (client, cli, mcp, pet-format-codex, desktop)
- **Protocol**: IPC protocol implemented by desktop server, used by client
- **State**: State machine drives desktop pet behavior
