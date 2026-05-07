# Claude Code + OpenPets

For Claude Code, use the dedicated companion integration:

https://github.com/alvinunreal/claude-pets

Claude Pets wires Claude Code hooks into OpenPets so your pet can react automatically during Claude sessions.

## Direct MCP option

If you only want the MCP server, add OpenPets manually:

```bash
claude mcp add openpets -- bunx @open-pets/mcp
```

Then add the shared OpenPets instructions from [README.md](README.md#shared-agent-instructions) to your `CLAUDE.md`.

## Test

Ask Claude Code:

> Start OpenPets if needed and show a short connected message.
