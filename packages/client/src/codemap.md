# packages/client/src/

Source code for the IPC client package.

## Responsibility

Implements the complete IPC client for connecting to OpenPets desktop, including connection management, request/response handling, and error translation.

## Design

- **Modular Structure**: 
  - `client.ts`: Main client implementation and singleton exports
  - `event-input.ts`: Input normalization and validation
  - `errors.ts`: Error class and type definitions
- **Connection Management**: 
  - Per-request socket creation (stateless protocol)
  - Configurable timeouts per operation
  - Optional endpoint verification on first connect
- **Request ID Generation**: Unique IDs with prefix, timestamp, and random suffix
- **Response Validation**: Strict validation of IPC responses with type guards

## Flow

**Send Event**:
```
sendEvent(input) → normalizeEventInput() → requestIpc() → parse/validate response → { ok, state }
```

**Health Check**:
```
getHealth() → requestIpc('health') → validateIpcHealth() → OpenPetsHealthV2
```

**Safe Send**:
```
safeSendEvent() → sendEvent() with short timeout → catch → { ok: false, error }
```

## Integration

- **Core IPC**: Implements client side of protocol defined in `@open-pets/core/ipc`
- **CLI**: Direct dependency for all CLI commands
- **MCP**: Used by MCP tools to communicate with desktop
- **External Projects**: Published as `@open-pets/client` on npm
