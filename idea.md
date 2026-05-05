# OpenPets Initial Idea

OpenPets is an open-source, local desktop pet for AI coding agents.

The core product is a small animated pet that lives on the user's desktop as a floating overlay. It reacts to AI coding agent activity, tool use, file edits, test runs, failures, completions, and user-input waits.

## One-line positioning

**OpenPets is a local desktop pet for AI coding agents.**

Shorter:

**Tamagotchi for AI coding agents.**

## Main product shape

OpenPets should start as:

- a local desktop overlay
- a small local IPC event server, hosted by the desktop app
- a CLI for sending events
- MCP-first Claude Code and OpenCode integration
- 1:1 support for Codex/Petdex animated pet packs
- high-quality macOS, Linux, and Windows support from phase 1

The first experience should be simple:

```bash
openpets start
openpets start --pet ./sample-pet
openpets event thinking
openpets event testing
openpets event error
openpets event success
```

The pet appears on screen and changes animation based on these events.

## Why overlay first

A floating overlay is the strongest first interface because it works across any editor, terminal, browser, or AI tool. It is not locked to Codex, OpenCode, VS Code, Cursor, or any single environment.

The overlay should feel like a small living companion while the developer works.

Example states:

- idle: pet chills or sleeps
- thinking: AI agent/model is working
- editing: files are being changed
- testing: tests are running
- success: tests/build passed
- error: tests/build failed
- waiting: tool needs user input
- waving: startup, greeting, attention, or permission request
- celebrating: task completed

## Flexible integration model

OpenPets should be integration-flexible by design, but the phase 1 product wedge is specifically AI coding agents. The generic event API is the architecture; the user-facing pitch is the pet reacting to Claude Code, OpenCode, tests, and coding work.

Architecture:

```txt
Any tool / script / AI agent / editor
        ↓
OpenPets CLI / MCP / IPC client
        ↓
Local OpenPets event server
        ↓
Floating animated pet overlay
```

OpenPets should not care where an event comes from. It only needs to know what happened and which pet state to show.

## Integration surfaces

### 1. CLI first

The CLI is the most important surface for developers.

```bash
openpets event thinking
openpets event editing
openpets event success
openpets event error
```

This lets users wire OpenPets into anything:

```bash
openpets event testing
bun test && openpets event success || openpets event error
```

### 2. Local IPC client

Useful for apps, editor extensions, and local tools running as the same user.

The supported programmatic surface is `@open-pets/client` over OS IPC. There is no localhost HTTP integration API.

```json
{
  "type": "agent.thinking",
  "state": "thinking",
  "source": "opencode",
  "message": "Planning changes"
}
```

### 3. Claude Code and OpenCode integrations

Agent integrations should prefer MCP:

- Claude Code: MCP config/instructions via dedicated `claude-pets`
- OpenCode: MCP config/instructions via dedicated `opencode-pets` where supported

Optional hook/plugin adapters can still emit generic state events, but authored speech belongs in MCP tools.

### 4. WebSocket later

Useful for realtime integrations.

```js
socket.send(JSON.stringify({
  type: "tests.running",
  source: "vitest"
}))
```

### 5. SDKs later

Possible packages:

- `@open-pets/sdk`
- `openpets-python`
- GitHub Action
- VS Code/Cursor extension

## Event design

Keep the event model generic, not Codex-specific.

Base states:

```txt
idle
thinking
working
editing
running
testing
waiting
waving
success
error
warning
celebrating
sleeping
```

Higher-level events can map to these states:

```txt
agent.thinking     → thinking
agent.editing      → editing
tests.running      → testing
tests.failed       → error
tests.passed       → success
user.input_needed  → waiting
user.permission     → waving
task.completed     → celebrating
```

## Pet format

OpenPets should support the Codex/Petdex pet format 1:1 first. Do not invent a new pet format before the existing Codex sprite format works.

Package structure:

```txt
sample-pet/
pet.json
spritesheet.webp or spritesheet.png
```

Phase 1 accepts local pet directories only. Zip import is deferred.

Spritesheet contract:

```txt
8 columns × 9 rows
192px × 208px per frame
1536px × 1872px total
```

Codex/Petdex animations already cover the important OpenPets emotions/states:

```txt
idle        → idle
thinking    → review
working     → running
editing     → running
testing     → waiting
waiting     → waiting or waving
waving      → waving
success     → jumping
error       → failed
warning     → failed
celebrating → jumping
sleeping    → idle
```

Petdex can be used as the pet source/registry, but OpenPets itself should be the local runtime, overlay, CLI, and integration layer.

## Relationship to Petdex

Petdex is a public gallery/registry for Codex-compatible animated pets.

OpenPets should use those pets, but should not just be another gallery.

Recommended separation:

- **Petdex**: gallery, registry, submissions, downloads
- **OpenPets**: local runtime, overlay, CLI, protocol, integrations

## MVP

Build a strong phase 1 that demonstrates the magic while proving Claude Code, OpenCode, and cross-platform desktop support:

1. `openpets start` opens a transparent always-on-top pet overlay.
2. `openpets event <state>` changes the pet animation.
3. OpenPets can load a local Codex/Petdex-compatible pet pack.
4. MCP tools can drive pet states and safe authored speech.
5. OpenCode plugin events can drive pet states.
6. macOS, Linux, and Windows are supported from the beginning.
7. Include a shell/test-runner demo.

Example demo:

```bash
openpets start
openpets event thinking --message "AI is planning"
openpets event editing --message "Changing files"
openpets event testing --message "Running tests"
openpets event error --message "3 tests failed"
openpets event success --message "All tests passed"
```

The first viral demo should show:

1. Claude Code or OpenCode starts working → pet wakes up/thinks
2. Agent edits/runs tools → pet works/runs
3. Tests fail → pet panics or gets sad
4. Tests pass/task completes → pet celebrates

## Possible repo structure

```txt
openpets/
  apps/
    desktop/
  packages/
    cli/
    core/
    pet-format-codex/
    integrations/
  examples/
    test-runner/
    opencode/
    claude-code/
  pets/
    sample-pet/
```

## Product principle

OpenPets should feel fun, hackable, and developer-native.

It should not start as a complex game, SaaS dashboard, or social network. The magic is simple: developer tools emit events, and a living pet reacts.
