# packages/mcp/src/

Source code for the MCP server package.

## Responsibility

Implements the MCP server with tool handlers, lease management, safety validation, and desktop launching.

## Design

- **Server (`server.ts`)**: Minimal bootstrap, delegates to tools
- **Tools (`tools.ts`)**: 
  - Tool registration with Zod schemas
  - Async handlers with `CallToolResult` returns
  - JSON-only responses
- **Lease Manager (`tools.ts`)**: 
  - `createMcpLeaseManager()` factory
  - Auto heartbeat with `setInterval`
  - Generation counter for operation cancellation
- **Safety (`safety.ts`)**: 
  - Regex-based pattern matching for dangerous content
  - `createSpeechLimiter()` for rate control
- **Launcher (`launcher.ts`)**: 
  - Platform-specific command resolution
  - Spawn with `detached: true`, `stdio: "ignore"`

## Flow

**Start Tool**:
```
readHealth() → if not running: launchOpenPetsDesktop() → wait for ready
  → acquireLease() → return { running, ready, lease }
```

**Say Tool**:
```
validateSpeechMessage() → limiter.allow() → lease.heartbeat() 
  → sendEvent() → return { sent, state }
```

**Release Tool**:
```
leaseManager.release() → return { released, running, activeLeases }
```

## Integration

- **MCP SDK**: `@modelcontextprotocol/sdk` for server and transport
- **Zod**: Schema validation for tool inputs
- **Client**: All desktop communication via `@open-pets/client`
- **Claude**: Communicates via stdio per MCP protocol
