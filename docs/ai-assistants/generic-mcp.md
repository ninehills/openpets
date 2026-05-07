# Generic MCP clients

Use this for any AI assistant that supports stdio MCP servers.

## 1. Install OpenPets desktop

Download and launch OpenPets from the official releases page:

https://github.com/alvinunreal/openpets/releases/latest

## 2. Add the MCP server

Use this MCP server config, adapting the root key to your client if needed:

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

Some clients use `servers` instead of `mcpServers`.

## 3. Add agent instructions

Paste the shared instructions from [README.md](README.md#shared-agent-instructions) into your client rules or project instructions.

## 4. Test

Ask your assistant:

> Check OpenPets health, start it if needed, then tell my pet you are connected.
