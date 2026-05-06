<p align="center">
  <img src="assets/openpets.png" alt="OpenPets - pixel art desktop pets for coding agents" width="100%" />
</p>

<h1 align="center">OpenPets</h1>

<p align="center">
  <strong>A tiny desktop pet for coding agents.</strong>
</p>

<p align="center">
  See agent progress, test runs, and coding state as a playful desktop companion.
</p>

---

## What is OpenPets?

OpenPets is a desktop pet that reacts while coding agents work.

- **Desktop companion** - a small pet that changes state while agents think, edit, test, and finish.
- **MCP ready** - agents can launch, talk to, and control the pet through the OpenPets MCP server.
- **Integration friendly** - use MCP, the TypeScript client, or companion integrations for automatic status updates.
- **Pet-pack friendly** - loads Codex style animated pet directories.


https://github.com/user-attachments/assets/fbad0d58-8040-4ebb-a26b-73fa497a4ceb



## Quick start

Install the desktop app, then connect your coding agent.

### 1. Install OpenPets desktop

Download the latest app from [OpenPets Releases](https://github.com/alvinunreal/openpets/releases/latest):

- **macOS Apple Silicon**: `OpenPets-*-arm64.dmg` or `OpenPets-*-arm64.zip`
- **macOS Intel**: `OpenPets-*-x64.dmg` or `OpenPets-*-x64.zip`
- **Windows**: `OpenPets-Setup-*-x64.exe`
- **Linux**: `OpenPets-*-x86_64.AppImage` or `OpenPets-*-amd64.deb`

Install or unzip it, then launch OpenPets. You should see the desktop pet and the OpenPets tray/menu-bar icon.

> Current builds are unsigned. macOS or Windows may show a security warning the first time you open the app.

If macOS says the app is damaged or should be moved to Trash, remove the quarantine flag and open it again:

```bash
xattr -dr com.apple.quarantine /Applications/OpenPets.app
open /Applications/OpenPets.app
```

See [INSTALL.md](INSTALL.md) for platform notes and troubleshooting.

### 2. Connect your agent

Use the companion integration for your agent when one exists:

- **Claude Code**: install [Claude Pets](https://github.com/alvinunreal/claude-pets) for Claude hooks and OpenPets setup.
- **OpenCode**: install [OpenCode Pets](https://github.com/alvinunreal/opencode-pets) for OpenCode plugin integration.

For Cursor, VS Code, Windsurf, or any other MCP-capable agent, configure the OpenPets MCP server directly. See [MCP integration](#mcp-integration) for copy-paste JSON and commands.

## MCP integration

The OpenPets MCP server lets agents control the desktop pet over the Model Context Protocol.

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

Once connected, an agent can use OpenPets tools to start the desktop app, check health, set pet states, show short speech bubbles, and release its session.

### Setup examples

<details>
<summary>Cursor</summary>

Add this to `~/.cursor/mcp.json` for global setup, or `.cursor/mcp.json` inside a project:

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

</details>

<details>
<summary>VS Code / GitHub Copilot</summary>

Add this to `.vscode/mcp.json` for a workspace setup:

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

Or add it to your user profile from the command line:

```bash
code --add-mcp '{"name":"openpets","command":"bunx","args":["@open-pets/mcp"]}'
```

VS Code uses `servers` as the root key, not `mcpServers`.

</details>

<details>
<summary>Windsurf</summary>

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

</details>

## Available tools:

- `openpets_health` - check whether the desktop app is reachable.
- `openpets_start` - launch OpenPets and acquire an agent session.
- `openpets_say` - show a short speech bubble and optional pet state.
- `openpets_set_state` - update the pet state without speech.
- `openpets_release` - release the agent session.

Supported states include `thinking`, `working`, `editing`, `running`, `testing`, `waiting`, `success`, and `error`.

The MCP server talks to the local OpenPets desktop app through the same local IPC client used by other integrations. Speech is intentionally short and validated before it appears on screen.
