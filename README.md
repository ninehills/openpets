<p align="center">
  <img src="assets/openpets.png" alt="OpenPets - pixel art desktop pets for coding agents" width="100%" />
</p>

<h1 align="center">OpenPets</h1>

<p align="center">
  <strong>A tiny desktop pet for Claude Code and coding agents.</strong>
</p>

<p align="center">
  See agent progress, test runs, and coding state as a playful desktop companion.
</p>

---

## What is OpenPets?

OpenPets is a desktop pet that reacts while Claude Code and other coding agents work.

- **Desktop companion** - a small pet that changes state while agents think, edit, test, and finish.
- **Claude Code ready** - MCP tools let Claude launch, talk to, and control the pet.
- **Automatic reactions** - pair with [Claude Pets](https://github.com/alvinunreal/claude-pets) for Claude Code hooks.
- **Pet-pack friendly** - loads Codex/Petdex-style animated pet directories.


https://github.com/user-attachments/assets/fbad0d58-8040-4ebb-a26b-73fa497a4ceb



## Quick start

Install the desktop app, connect it to Claude Code, then enable automatic Claude reactions.

### 1. Install OpenPets desktop

Download the latest app from [OpenPets Releases](https://github.com/alvinunreal/openpets/releases/latest):

- **macOS Apple Silicon**: `OpenPets-*-arm64.dmg` or `OpenPets-*-arm64.zip`
- **Windows**: `OpenPets-Setup-*-x64.exe`
- **Linux**: `OpenPets-*-x86_64.AppImage` or `OpenPets-*-amd64.deb`

Install or unzip it, then launch OpenPets. You should see the desktop pet and the OpenPets tray/menu-bar icon.

> Current builds are unsigned. macOS or Windows may show a security warning the first time you open the app.

If macOS says the app is damaged or should be moved to Trash, remove the quarantine flag and open it again:

```bash
xattr -dr com.apple.quarantine /Applications/OpenPets.app
open /Applications/OpenPets.app
```

### 2. Connect OpenPets to Claude Code

Add the OpenPets MCP server:

```bash
claude mcp add -s user openpets -- bunx @open-pets/mcp
```

Restart Claude Code, then confirm it is listed:

```bash
claude mcp list
```

### 3. Enable automatic Claude reactions

For automatic state changes while Claude works, install [Claude Pets](https://github.com/alvinunreal/claude-pets) hooks globally:

```bash
bunx @open-pets/claude-pets install
```

Restart Claude Code. Claude activity will now update the pet automatically:

- prompt submitted → thinking
- file edits → editing
- shell commands → running/testing
- permission prompts → waving/waiting
- completed/failure → success/error, then idle

Test the integration:

```bash
bunx @open-pets/claude-pets test-event thinking
```

See [INSTALL.md](INSTALL.md) for platform notes and troubleshooting.

## Claude Code integration

OpenPets works best with Claude Code in two parts:

1. **OpenPets MCP** - lets Claude intentionally launch, talk to, and control the pet.
2. **[Claude Pets](https://github.com/alvinunreal/claude-pets)** - installs Claude Code hooks so the pet reacts automatically while Claude works.

Install both for the full experience:

```bash
claude mcp add -s user openpets -- bunx @open-pets/mcp
bunx @open-pets/claude-pets install
```

For setup details, troubleshooting, and hook behavior, see:

https://github.com/alvinunreal/claude-pets

## Integrations

OpenPets is the desktop app. Use these companion integrations for automatic agent status updates:

- [Claude Pets](https://github.com/alvinunreal/claude-pets) - Claude Code hooks that update OpenPets while Claude works.
- [OpenCode Pets](https://github.com/alvinunreal/opencode-pets) - OpenCode plugin integration for OpenPets status updates.

## Development

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

## Checks

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

OpenPets is available as a v0.1 desktop release for macOS, Windows, and Linux. Code signing and auto-update polish are planned for future releases.
