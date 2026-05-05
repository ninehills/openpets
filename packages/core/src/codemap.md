# packages/core/src/

Source code for the core package.

## Responsibility

Implements the complete domain logic for OpenPets: state definitions, event validation, state reduction, lifecycle leases, IPC protocol, and configuration management.

## Design

- **Pure Functions**: All state transformations are pure, testable functions
- **Validation-First**: Every input validated before processing with detailed error messages
- **Type Safety**: Full TypeScript coverage with exported type definitions
- **Zero Dependencies**: No external runtime dependencies

## Flow

**State Machine**:
```
Event → validateOpenPetsEvent() → reducePetEvent() → PetRuntimeState
                                      ↓
                              tickPetState() [expiration check]
```

**IPC Request**:
```
Raw JSON → parseIpcFrame() → validateIpcRequest() → dispatchIpcRequest() → IpcResponse
```

**Lease Management**:
```
LeaseParams → validateLeaseParams() → applyLeaseAction() → LeaseResult
                ↓
         pruneExpiredLeases() [periodic cleanup]
```

## Integration

- **Desktop**: Main process uses all modules directly
- **Client**: Uses IPC protocol and validation functions
- **CLI/MCP**: Use event creation and validation
- **Pet Format**: Uses Codex state mapping for animation
