# OpenPets Phase 1 Features

This is the feature set expected after the initial launch implementation.

## Core app

- Cross-platform desktop app for macOS, Linux, and Windows.
- Floating transparent pet overlay.
- Always-on-top pet window.
- Basic drag/move support.
- Scale setting or scale config.
- Hide/sleep/quit controls.
- Non-annoying default placement.
- Local-only event server at `http://127.0.0.1:4738`.
- Local HTTP endpoint: `POST /event`.

## Pet rendering

- 1:1 Codex/Petdex pet format support.
- Phase 1 loads local pet directories only. Zip import is deferred.
- Load local pet directories containing:

```txt
pet.json
spritesheet.webp or spritesheet.png
```

Deferred zip support can later be added as a separate import command, for example `openpets import pet.zip`.

- Correct Codex spritesheet rendering:
  - 8 columns
  - 9 rows
  - 192×208 frames
  - 1536×1872 full spritesheet
- CSS sprite animation using existing Codex/Petdex rows.

OpenPets-to-Codex state mapping:

```txt
idle        → idle
thinking    → review
working     → running
editing     → running
running     → running
testing     → waiting
waiting     → waiting
waving      → waving
success     → jumping
error       → failed
warning     → failed
celebrating → jumping
sleeping    → idle
```

## CLI

Phase 1 CLI commands:

```bash
openpets start
openpets start --pet ./sample-pet
openpets event <state>
openpets show
openpets hide
openpets sleep
openpets quit
```

`openpets start --pet <path>` is required in phase 1. It should accept a local Codex/Petdex pet directory, store it as the current pet in config, launch the overlay, and start the local event server. Zip paths are not supported in phase 1.

If `--pet` is omitted, OpenPets should load the last configured pet or fall back to a bundled sample pet.

`openpets show`, `hide`, `sleep`, and `quit` are required recovery controls so users can recover from hidden/frameless/non-focusable overlay states without editing config manually.

Example events:

```bash
openpets event thinking --source claude-code --message "Thinking..."
openpets event testing --source bun --message "Running tests"
openpets event error --message "Tests failed"
openpets event success --message "All tests passed"
```

`openpets event <state>` supports `--source`, `--message`, `--tool`, and `--type`. Defaults are `source: cli` and `type: state.<state>`.

## Event/state system

- Shared TypeScript event schema.
- Allowed states:
  - `idle`
  - `thinking`
  - `working`
  - `editing`
  - `running`
  - `testing`
  - `waiting`
  - `waving`
  - `success`
  - `error`
  - `warning`
  - `celebrating`
  - `sleeping`
- Deterministic state reducer.
- Timeout/debounce behavior:
  - `success`, `error`, `warning`, and `celebrating` are temporary states.
  - `waiting` is sticky until an accepted non-`waiting` event arrives.
  - `waving` is a public state for startup, greeting, attention, and permission/input request moments.
  - `thinking`, `working`, `editing`, and `testing` are long-running states.
  - Duplicate same-state events are ignored briefly.
  - Noisy `working` events do not instantly override visible `success` or `error` states.

## Claude Code integration

- Claude Code hooks bridge.
- Dedicated `claude-pets hook` reads hook JSON from stdin.
- Defensive parsing of Claude Code hook payloads.
- Metadata-only event forwarding to OpenPets.
- No-op behavior when OpenPets is not running.
- Integration snippet generation:
  - `bunx claude-pets print`
  - `bunx claude-pets install`

Expected state mapping:

```txt
prompt submitted       → thinking
edit/write tool        → editing
bash/tool use          → running or testing
permission/input wait  → waiting or waving
startup/greeting       → waving
stop/success           → success or celebrating
failure/error          → error
```

## OpenCode integration

- OpenCode plugin bridge.
- Self-contained plugin template with no required OpenPets package dependency.
- Integration commands:
  - `bunx opencode-pets print-plugin`
  - `bunx opencode-pets install`
- Plugin listens to core OpenCode signals such as:
  - `tool.execute.before`
  - `tool.execute.after`
- Minimum required OpenCode signals:
  - `session.status`
  - `tool.execute.before`
  - `tool.execute.after`
  - `permission.asked`
  - `session.error`
- Optional useful OpenCode signals:
  - `message.part.updated`
  - `file.edited`
- OpenCode signal mapping should be isolated in one small adapter/table so it is easy to update if OpenCode changes event names or payload shapes.
- Metadata-only event forwarding to OpenPets.
- No-op behavior when OpenPets is not running.

Expected state mapping:

```txt
session busy/reasoning → thinking
session idle           → idle
tool running           → working
file edited/patch      → editing
permission asked       → waving
tool/session success   → success
tool/session error     → error
```

## Shell/test-runner demo

OpenPets should work without any AI-agent integration:

```bash
openpets event testing
bun test && openpets event success || openpets event error
```

## Privacy/security

- API binds only to `127.0.0.1`.
- Event schema validation.
- Large payload rejection.
- No prompt content sent by default.
- No model responses sent by default.
- No diffs sent by default.
- No shell output sent by default.
- No file content sent by default.
- Avoid sending `cwd` by default unless needed.

## Dev/release setup

- Bun workspace monorepo.
- Electron desktop app.
- Vite + React overlay renderer.
- TypeScript packages.
- Bun tests where possible.
- Local run/test/build checks first.
- Manual cross-platform validation for macOS, Linux, and Windows before release.
- Basic docs:
  - quickstart
  - Claude Code setup
  - OpenCode setup
  - pet pack format
  - shell/test examples

## Not included in phase 1

- Pet gallery.
- Marketplace.
- Accounts.
- Cloud sync.
- WebSocket API.
- SDKs.
- MCP server.
- Zip pet import.
- GitHub Actions CI/build matrix.
- GitHub Actions product integration.
- Observer/watch modes.
- New OpenPets-specific pet format.
- Multi-pet game mechanics.
- Complex settings UI.
