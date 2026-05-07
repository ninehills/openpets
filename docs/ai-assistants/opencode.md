# OpenCode + OpenPets

For OpenCode, use the dedicated companion integration:

https://github.com/alvinunreal/opencode-pets

OpenCode Pets wires OpenCode lifecycle events into OpenPets so your pet can react automatically while OpenCode works.

## Direct MCP option

If you only want the MCP server, configure OpenCode with:

```json
{
  "mcp": {
    "openpets": {
      "type": "local",
      "command": ["bunx", "@open-pets/mcp"],
      "enabled": true
    }
  }
}
```

Then add the shared OpenPets instructions from [README.md](README.md#shared-agent-instructions) to your OpenCode instructions.

## Test

Ask OpenCode:

> Start OpenPets if needed and show a short connected message.
