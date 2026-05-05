# openpets/packages/mcp/

Model Context Protocol server for Claude Code integration.

## Responsibility

Provides MCP tools that allow Claude Code to control OpenPets: check health, launch desktop, send speech updates, set states, and manage session leases.

## Design

- **MCP Server (`server.ts`)**: 
  - Uses `@modelcontextprotocol/sdk`
  - Stdio transport for Claude Code communication
  - Server info: name "openpets", version "0.0.0"
- **Tools (`tools.ts`)**: 
  - `openpets_health`: Check if desktop is running
  - `openpets_start`: Launch desktop and acquire lease
  - `openpets_release`: Release session lease
  - `openpets_say`: Send speech bubble with state (rate-limited, safety-checked)
  - `openpets_set_state`: Set pet state without speech
- **Lease Manager**: 
  - Per-session lease with auto-acquire on start
  - Heartbeat every 30s while active
  - Auto-cleanup on release
- **Safety (`safety.ts`)**: 
  - Speech message validation (no URLs, paths, commands, secrets, logs)
  - Rate limiting (3s min interval, 30s duplicate window)
  - Max 100 characters
- **Launcher (`launcher.ts`)**: 
  - Cross-platform desktop app detection and launch
  - Environment overrides: `OPENPETS_DESKTOP_COMMAND`, `OPENPETS_DESKTOP_APP`
  - Platform defaults: macOS (Open.app), Windows (.exe), Linux (binaries)

## Flow

1. **Claude Starts**: MCP server connects via stdio
2. **Tool Call**: Claude calls `openpets_start` → Launch if needed → Acquire lease
3. **During Work**: Claude calls `openpets_say` for progress updates
4. **Session End**: Claude calls `openpets_release` → Stop heartbeats → Release lease

## Integration

- **Client**: Uses `@open-pets/client` for all desktop communication
- **Core**: Uses state types and lease system
- **Claude Code**: Registered via `claude mcp add -s user openpets -- bunx @open-pets/mcp`
- **Desktop**: Controls running desktop app via IPC
