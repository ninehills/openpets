# VS Code / GitHub Copilot + OpenPets

## 1. Install OpenPets desktop

Download and launch OpenPets from https://github.com/alvinunreal/openpets/releases/latest.

## 2. Configure MCP

For a workspace setup, create `.vscode/mcp.json`:

```json
{
  "servers": {
    "openpets": {
      "type": "stdio",
      "command": "bunx",
      "args": ["@open-pets/mcp"]
    }
  }
}
```

VS Code uses `servers` as the root key, not `mcpServers`.

You can also add the server from the command line:

```bash
code --add-mcp '{"name":"openpets","command":"bunx","args":["@open-pets/mcp"]}'
```

## 3. Add instructions

Add the shared OpenPets instructions from [README.md](README.md#shared-agent-instructions) to your workspace instructions.

## 4. Test

Ask Copilot Chat:

> Check OpenPets health and show a short connected message.
