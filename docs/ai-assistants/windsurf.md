# Windsurf + OpenPets

## 1. Install OpenPets desktop

Download and launch OpenPets from https://github.com/alvinunreal/openpets/releases/latest.

## 2. Configure MCP

Add this to `~/.codeium/windsurf/mcp_config.json` on macOS/Linux, or `%USERPROFILE%\.codeium\windsurf\mcp_config.json` on Windows:

```json
{
  "mcpServers": {
    "openpets": {
      "command": "bunx",
      "args": ["@open-pets/mcp"]
    }
  }
}
```

Fully quit and reopen Windsurf after changing MCP config.

## 3. Add rules

Add the shared OpenPets instructions from [README.md](README.md#shared-agent-instructions) to your Windsurf rules.

## 4. Test

Ask Windsurf:

> Start OpenPets if needed and show a short connected message.
