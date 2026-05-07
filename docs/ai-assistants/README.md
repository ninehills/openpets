# OpenPets AI assistant integrations

OpenPets works with AI coding tools through companion integrations or the OpenPets MCP server.

Official site: https://openpets.dev  
Official GitHub: https://github.com/alvinunreal/openpets

## Setup guides

| Assistant | Best path | Guide |
| --- | --- | --- |
| Claude Code | Companion integration with hooks | [claude-code.md](claude-code.md) |
| OpenCode | Companion plugin integration | [opencode.md](opencode.md) |
| Cursor | Direct MCP config | [cursor.md](cursor.md) |
| VS Code / GitHub Copilot | Direct MCP config | [vscode.md](vscode.md) |
| Windsurf | Direct MCP config | [windsurf.md](windsurf.md) |
| Zed | Direct MCP config + project rules | [zed.md](zed.md) |
| Any MCP client | Generic stdio MCP server | [generic-mcp.md](generic-mcp.md) |

## Shared agent instructions

Add this to your assistant rules, project instructions, or agent memory after configuring MCP:

```md
Use OpenPets for safe, short progress updates while you work.

- At the start of a task, call `openpets_start` if OpenPets is not already running.
- Use `openpets_set_state` for silent status changes like `thinking`, `working`, `editing`, `testing`, `waiting`, `success`, or `error`.
- Use `openpets_say` occasionally for brief status bubbles. Keep messages under 100 characters.
- Never send user text, code, file paths, command output, logs, diffs, URLs, secrets, tokens, exact errors, or private data to `openpets_say`.
- Before your final response, set `success` when work completed or `error` when blocked.
- Call `openpets_release` when your session is done if your client keeps MCP servers alive.
```

## MCP server

Most clients that support stdio MCP can use:

```json
{
  "mcpServers": {
    "openpets": {
      "type": "stdio",
      "command": "bunx",
      "args": ["@open-pets/mcp"]
    }
  }
}
```

The MCP server launches or talks to the local OpenPets desktop app through local IPC.

## Tools

- `openpets_health` - check whether the desktop app is reachable.
- `openpets_start` - launch OpenPets and acquire an agent session.
- `openpets_say` - show a short speech bubble and optional pet state.
- `openpets_set_state` - update the pet state without speech.
- `openpets_release` - release the agent session.
