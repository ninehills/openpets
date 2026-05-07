# Cursor + OpenPets

## 1. Install OpenPets desktop

Download and launch OpenPets from https://github.com/alvinunreal/openpets/releases/latest.

## 2. Configure MCP

Add this to `~/.cursor/mcp.json` for global setup, or `.cursor/mcp.json` in a project:

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

Restart Cursor after changing MCP config.

## 3. Add Cursor rules

Add the shared OpenPets instructions from [README.md](README.md#shared-agent-instructions) to your Cursor Rules or project rules.

## 4. Test

Ask Cursor:

> Use OpenPets to show that you are connected.
