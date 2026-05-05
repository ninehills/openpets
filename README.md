<p align="center">
  <img src="assets/openpets.png" alt="OpenPets — pixel art desktop pets for coding agents" width="100%" />
</p>

<h1 align="center">OpenPets</h1>

<p align="center">
  <strong>A tiny desktop pet for Claude, OpenCode, and your local dev tools.</strong>
</p>

<p align="center">
  Agent progress, test runs, and coding state — visualized as a playful desktop companion.
</p>

---

## Why OpenPets?

Coding agents are powerful, but they often feel invisible while they work. OpenPets gives them a small, friendly presence on your desktop.

- **Local-first** — no cloud service, no accounts, no remote API.
- **Agent-native** — MCP tools for Claude Code and future agents.
- **Safe by default** — speech messages reject paths, commands, logs, URLs, secrets, and exact errors.
- **No port drama** — local OS IPC instead of a fixed localhost HTTP port.
- **Pet-pack friendly** — loads Codex/Petdex-style animated pet directories.

```txt
Claude / OpenCode / CLI
        ↓ MCP or @openpets/client
same-user OS IPC
        ↓
OpenPets desktop pet
```

## Install

OpenPets `0.1.0` is a desktop preview. macOS is the known-good baseline; Windows and Linux artifacts are preview-quality until native-host smoke testing is complete.

1. Download the latest artifact for your platform from GitHub Releases.
2. Install or unzip it.
3. Launch OpenPets. It appears in the menu bar/tray and shows the desktop pet.

See [INSTALL.md](INSTALL.md) for Claude Code setup, unsigned-preview notes, and troubleshooting.

## Agent integrations

OpenPets is the desktop app and local IPC/MCP runtime. Use these companion packages for automatic agent status updates:

- [Claude Pets](https://github.com/alvinunreal/claude-pets) — Claude Code hooks that update OpenPets while Claude works.
- [OpenCode Pets](https://github.com/alvinunreal/opencode-pets) — OpenCode plugin integration for OpenPets status updates.

## Developer quick start

Use this if you are working from the source repo:

```bash
git clone https://github.com/alvinunreal/openpets.git
cd openpets
bun install
bun run build
```

Start the desktop pet:

```bash
bun packages/cli/src/index.ts start
```

Send it a state:

```bash
bun packages/cli/src/index.ts event thinking --message "Planning the next step"
bun packages/cli/src/index.ts event testing
bun packages/cli/src/index.ts event success --message "That worked"
```

Control the window:

```bash
bun packages/cli/src/index.ts show
bun packages/cli/src/index.ts hide
bun packages/cli/src/index.ts sleep
bun packages/cli/src/index.ts quit
```

## Claude Code setup

For preview installs, add the MCP server to Claude Code:

```bash
claude mcp add -s user openpets -- bunx @openpets/mcp
```

If the MCP package has not been published yet, build OpenPets first:

```bash
bun run build
```

Add the MCP server to Claude Code:

```bash
claude mcp add -s user openpets -- bun /path/to/openpets/packages/mcp/dist/index.js
```

Example:

```bash
claude mcp add -s user openpets -- bun /Users/alvin/repos/pets/openpets/packages/mcp/dist/index.js
```

Restart Claude Code. Then Claude can use:

| Tool | Purpose |
| --- | --- |
| `openpets_health` | Check if the desktop pet is reachable. |
| `openpets_start` | Launch the local desktop pet if needed. |
| `openpets_set_state` | Set status without speech. |
| `openpets_say` | Send a short, safe progress message. |
| `openpets_release` | Release this Claude session's lease without quitting shared pets. |

Recommended agent flow:

```txt
openpets_health → openpets_start if needed → openpets_say occasionally
```

## Safe speech, not raw transcripts

`openpets_say` is for short authored progress updates, not logs or transcripts.

Good:

```txt
I’m mapping the moving parts.
Running a quick check.
I hit a snag and I’m checking why.
That worked.
```

Rejected:

```txt
I’m editing src/auth/session.ts.
Running npm test -- --token abc123.
Error: Cannot read properties of undefined.
Check https://example.com
```

The validator rejects file paths, shell commands, URLs, secrets/tokens, markdown/code blocks, logs, stack traces, exact errors, and long encoded strings.

## Architecture

OpenPets uses MCP for agent-facing tools and same-user OS IPC for local desktop communication.

```txt
packages/mcp      MCP stdio server for agents
packages/client   IPC-only TypeScript client
packages/core     event, reducer, state, IPC contracts
packages/cli      local CLI
apps/desktop      Electron overlay + IPC server
```

IPC endpoints:

- macOS/Linux: Unix socket
- Windows: named pipe

There is intentionally **no** localhost HTTP integration API and **no** fixed port.

## Development

Run tests:

```bash
bun test packages/core/src packages/client/src packages/cli/src packages/mcp/src
```

Typecheck everything:

```bash
bun run typecheck
```

Build everything:

```bash
bun run build
```

Run the desktop in dev mode:

```bash
bun run dev:desktop
```

## Status

OpenPets is early and local-first. The v0.1 target is a desktop preview with macOS as the known-good baseline, Windows/Linux preview artifacts after native-host smoke testing, Claude MCP support, and developer-oriented source workflows. Auto-update, signing polish, and a production CLI are later.
