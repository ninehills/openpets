# openpets/packages/client/

TypeScript IPC client for communicating with the OpenPets desktop app.

## Responsibility

Provides a high-level TypeScript API for external tools to connect to and control the OpenPets desktop application via IPC.

## Design

- **Client Interface (`client.ts`)**: 
  - `createOpenPetsClient()` factory with configurable options
  - Methods: `getHealth()`, `sendEvent()`, `windowAction()`, `selectPet()`, lease operations
  - Default singleton client for convenience exports
  - Connection pooling with optional health verification
- **Event Input (`event-input.ts`)**: 
  - Flexible input types (full event or partial with defaults)
  - `normalizeEventInput()` validates and fills defaults
- **Error Handling (`errors.ts`)**: 
  - `OpenPetsClientError` class with error codes
  - Codes: not-running, timeout, not-openpets, invalid-response, incompatible-protocol, rejected, network-error
- **IPC Transport**: 
  - Node.js `net.createConnection()` for Unix sockets/named pipes
  - Request/response correlation with unique IDs
  - Timeout handling with configurable deadlines

## Flow

1. **Connect**: Resolve endpoint → Optional health check → Create socket
2. **Request**: Serialize request → Write to socket → Wait for response
3. **Response**: Buffer data until newline → Parse JSON → Validate → Return result
4. **Error**: Socket errors mapped to `OpenPetsClientError` with appropriate codes

## Integration

- **Core**: Uses IPC protocol, event validation, and types from `@open-pets/core`
- **CLI**: Primary interface for CLI commands
- **MCP**: Used by MCP server to communicate with desktop
- **External**: Can be used by any TypeScript/JavaScript tool
