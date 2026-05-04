# OpenPets Build Plan

This is the recommended plan before coding the initial OpenPets repo.

## North star

OpenPets is a local animated pet overlay for AI coding agents.

The first version should prove one thing:

> Claude Code, OpenCode, or a shell script can send an event, and the pet reacts instantly on the desktop.

The broader generic event API matters, but phase 1 should be judged by the AI-agent experience and by whether the overlay works reliably on macOS, Linux, and Windows.

## Non-goals for v0

- No gallery.
- No SaaS dashboard.
- No complex game mechanics.
- No account system.
- No pet marketplace.
- No dependence on Codex internals.

## Phase 1 architecture

```txt
openpets CLI
    ├── start          starts overlay app + local event server
    ├── event          sends local event
    ├── hook           handles Claude Code hook payloads
    └── integrate      prints/installs Claude/OpenCode snippets

local event server
    ├── HTTP API       POST /event
    ├── state machine  maps events to pet states
    └── pet loader     loads one Codex/Petdex pet pack

overlay app
    ├── transparent always-on-top window
    ├── sprite renderer
    ├── speech bubble/status label
    └── basic position/scale/hide controls
```

Prefer hosting the event server inside the overlay app at first:

```txt
openpets start
  -> launches desktop app
  -> desktop app hosts http://127.0.0.1:4738/event
  -> CLI/bridges POST events to that local server
```

A separate background process can come later if needed.

## Phase 1 requirements

Phase 1 is intentionally ambitious because implementation can be parallelized with coding agents. Required phase 1 scope:

- macOS support
- Linux support
- Windows support
- Codex/Petdex pet rendering 1:1
- local HTTP event API
- CLI event sender
- OpenCode plugin bridge
- Claude Code hooks bridge
- shell/test-runner demo

Each platform should be treated as first-class from the beginning, not as a later port.

## Suggested tech choices

### Recommended phase 1 stack

Use this stack for phase 1:

- **Desktop app:** Electron
- **Language:** TypeScript everywhere
- **Renderer:** Vite + React
- **Runtime/package manager:** Bun
- **Workspace:** Bun workspaces
- **Local API:** Node-compatible HTTP server inside Electron main process
- **CLI:** TypeScript CLI built/run with Bun
- **Tests:** Bun test where possible, Vitest only if a package needs it
- **Packaging:** electron-builder or Electron Forge after the dev loop works
- **Initial validation:** local run/test/build checks first; GitHub Actions CI later

The main reason to choose Electron over Tauri in phase 1 is cross-platform overlay reliability. Electron is heavier, but transparent frameless always-on-top windows are better-trodden across macOS, Linux, and Windows. Tauri can be reconsidered later if Electron size/resource usage becomes a real adoption problem.

### Desktop overlay

Use **Electron** for phase 1:

- transparent always-on-top window
- mature cross-platform desktop APIs
- reliable frameless/transparent window behavior
- web renderer for CSS sprite animation
- main process can own window, tray/menu, config, and local HTTP server

Do not use Tauri in phase 1 unless Electron proves impossible for the overlay. Tauri is smaller and elegant, but it adds Rust/WebView/platform variability before the product is proven.

### Renderer

Use **Vite + React** for the overlay renderer.

Reasons:

- Petdex already has React sprite-rendering patterns that can be adapted.
- The overlay will need clean UI components for the pet, speech bubble, controls, and future settings.
- React keeps the renderer structured without adding much complexity.

Avoid a custom canvas renderer in phase 1. Use CSS sprites for Codex/Petdex compatibility.

### Cross-platform overlay target

Phase 1 must support macOS, Linux, and Windows.

Required behavior on all three:

- transparent always-on-top window
- non-annoying default placement
- basic drag/move
- scale setting or config
- hide/sleep/quit path
- local HTTP server bound to `127.0.0.1`
- Codex sprite animations render correctly

Known platform risks to test early:

- macOS: always-on-top behavior, click-through/drag, signing/notarization later
- Linux: X11 vs Wayland transparency/always-on-top behavior, window manager differences
- Windows: transparent window behavior, taskbar/focus quirks, firewall prompts if any

Platform validation should happen during milestone 1, not after integrations are finished.

### CLI/runtime

Use TypeScript on Bun for speed of iteration.

Recommended split:

- Electron app for overlay and local event server
- TypeScript package for CLI + integrations
- shared TypeScript event/schema/state package

## Package layout

Recommended Bun workspace monorepo:

```txt
openpets/
  bun.lock
  package.json              # workspaces config
  apps/
    desktop/              # Electron overlay app
  packages/
    cli/                  # openpets command
    core/                 # event types, state machine, mapping
    pet-format-codex/     # Codex/Petdex loader
    # Claude/OpenCode bridge helpers live in packages/cli/src/integrations for phase 1
  examples/
    shell/
    test-runner/
    claude-code/
    opencode/
  docs/
    integration-research.md
    build-plan.md
```

Root `package.json` should use Bun workspaces, not pnpm-specific workspace tooling:

```json
{
  "name": "openpets",
  "private": true,
  "workspaces": ["apps/*", "packages/*"]
}
```

Avoid adding Turborepo or other orchestration until builds become slow enough to justify it.

## Core API

### CLI

```bash
openpets start
openpets start --pet ./sample-pet
openpets event idle
openpets event thinking --source claude-code --message "Thinking..."
openpets event testing --source bun --message "Running tests"
openpets event error --message "3 tests failed"
openpets event success --message "All tests passed"
openpets show
openpets hide
openpets sleep
openpets quit
openpets hook claude-code
openpets integrate claude-code
openpets integrate opencode
```

Integration install behavior should default to safe output:

```bash
openpets integrate opencode --print
openpets integrate opencode --install
openpets integrate claude-code --print
openpets integrate claude-code --install
```

Default behavior should be `--print` or equivalent unless the user explicitly requests installation.

`openpets start --pet <path>` is required for phase 1. It should accept a local Codex/Petdex pet directory, store it as the current pet in config, launch the overlay, and start the local event server. If `--pet` is omitted, load the last configured pet or a bundled sample pet. Zip paths are not supported in phase 1.

### HTTP

```http
POST /event
```

```json
{
  "type": "tests.failed",
  "state": "error",
  "source": "vitest",
  "message": "3 tests failed"
}
```

### Internal state machine

Rules:

- `error`, `success`, `celebrating` are usually temporary states.
- after temporary state finishes, return to previous long-running state or `idle`.
- `waiting` should persist until another event arrives.
- `waving` is a public state for startup, greeting, attention, and permission/input request moments.
- noisy events should be debounced.
- duplicate same-state events should be ignored briefly.
- `success`/`error` should not be instantly overridden by noisy `working` events.
- `thinking`, `working`, `editing`, and `testing` are long-running states.

## Pet format support

Support Codex/Petdex format 1:1 in phase 1. Do not invent a new OpenPets pet format until this works.

Required files:

```txt
pet.json
spritesheet.webp or spritesheet.png
```

Phase 1 pet input is directory-only:

```txt
sample-pet/
├── pet.json
└── spritesheet.webp
```

Zip import is deferred to a later `openpets import pet.zip` style command.

Frame contract:

```txt
frame width: 192
frame height: 208
columns: 8
rows: 9
spritesheet: 1536 × 1872
```

States:

```ts
const codexStates = [
  { id: "idle", row: 0, frames: 6, durationMs: 1100 },
  { id: "running-right", row: 1, frames: 8, durationMs: 1060 },
  { id: "running-left", row: 2, frames: 8, durationMs: 1060 },
  { id: "waving", row: 3, frames: 4, durationMs: 700 },
  { id: "jumping", row: 4, frames: 5, durationMs: 840 },
  { id: "failed", row: 5, frames: 8, durationMs: 1220 },
  { id: "waiting", row: 6, frames: 6, durationMs: 1010 },
  { id: "running", row: 7, frames: 6, durationMs: 820 },
  { id: "review", row: 8, frames: 6, durationMs: 1030 },
]
```

OpenPets state mapping:

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

This means all phase 1 emotions/animations should come from existing Codex pet rows.

## Phase 1 integrations

Phase 1 should include both Claude Code and OpenCode support, but keep each bridge small. They should only translate host events into OpenPets events. They should not add MCP, watchers, SDKs, or deep observability yet.

### OpenCode

Ship an `openpets integrate opencode` command that installs or prints a plugin.

The plugin should:

- listen to `session.status`
- listen to `tool.execute.before`
- listen to `tool.execute.after`
- listen to `permission.asked`
- listen to `session.error`
- optionally listen to `message.part.updated` and `file.edited` where stable/useful
- send events to `http://127.0.0.1:4738/event`
- never throw if OpenPets is not running
- send only metadata by default

Keep OpenCode event mapping isolated in one adapter/table. The bridge should be easy to update if OpenCode changes signal names or payload shapes.

Minimum required mapping:

```txt
session.status busy       → thinking
session.status idle       → idle
tool.execute.before Bash  → running or testing
tool.execute.before edit  → editing
tool.execute.after error  → error
tool.execute.after ok     → success briefly
permission.asked          → waving
session.error             → error
```

Optional mapping:

```txt
message.part.updated reasoning → thinking
file.edited                    → editing
```

### Claude Code

Ship an `openpets integrate claude-code` command that installs or prints settings snippets.

The bridge should:

- expose `openpets hook claude-code`
- read hook JSON from stdin
- map hook events to OpenPets events
- send events to the local event server
- fail silently/non-disruptively by default
- send only metadata by default

### Shell/test runner

This is the lowest-friction demo:

```bash
openpets event testing
bun test && openpets event success || openpets event error
```

Include this in docs and examples.

## Phase 1 acceptance criteria

Phase 1 is done when all of these are true:

- `openpets start --pet ./sample-pet` opens a pet overlay on macOS, Linux, and Windows.
- `openpets event thinking`, `testing`, `error`, and `success` change the animation reliably.
- Codex/Petdex `pet.json + spritesheet.webp/png` packs render using the correct 8×9 grid.
- The overlay hosts `POST http://127.0.0.1:4738/event` locally.
- The CLI sends events to the local event server.
- OpenCode plugin bridge drives at least: `thinking`, `working/editing`, `waiting`, `waving`, `success`, `error`.
- Claude Code hook bridge drives at least: `thinking`, `tool/edit/run`, `waiting`, `waving`, `success`, `error`.
- Bridges no-op silently when OpenPets is not running.
- No prompt/code/file content is sent by default.
- Basic overlay controls exist: move/drag, scale or scale config, hide/sleep/quit.
- A shell/test-runner demo works without Claude Code or OpenCode.

## Agent-parallel implementation strategy

Because this project is being built with coding agents, phase 1 can be split into parallel lanes after the core event contract is defined.

### Sequential foundation

Do this first:

1. Define event schema, allowed states, and Codex state mapping.
2. Define package layout and shared core package boundaries.

### Parallel lanes

After the foundation, split work across agents:

1. **Desktop/cross-platform lane**
   - Electron overlay shell
   - transparent always-on-top window
   - local HTTP event server
   - macOS/Linux/Windows validation

2. **Pet renderer lane**
   - Codex/Petdex `pet.json` loader
   - spritesheet renderer
   - state-to-row mapping
   - sample pet fixtures/tests

3. **CLI lane**
   - `openpets start`
   - `openpets event <state>`
   - `openpets show`
   - `openpets hide`
   - `openpets sleep`
   - `openpets quit`
   - `openpets integrate ... --print/--install`
   - `openpets hook claude-code`

4. **OpenCode integration lane**
   - plugin template
   - event mapping
   - no-op behavior
   - example project setup

5. **Claude Code integration lane**
   - hook bridge parser
   - settings snippets
   - event mapping
   - no-op behavior

6. **Validation/docs lane**
   - test commands
   - platform checklist
   - demo scripts
   - README quickstart

### Integration rule

Parallel lanes should communicate only through the shared event schema and local HTTP API. Avoid tight coupling between the overlay, CLI, and agent bridges.

## Phase 1 milestones

### Milestone 1: cross-platform manual demo

- Load one local Codex/Petdex pet.
- Show it in a transparent overlay on macOS, Linux, and Windows.
- Manually switch states from CLI.
- HTTP `/event` works.
- Basic timeout/debounce rules work.
- Basic position/scale/hide behavior exists, even if rough.

### Milestone 2: shell/test-runner demo

- `openpets event testing` before a test run.
- `openpets event success/error` after test result.
- Demo works without any AI-agent integration.

### Milestone 3: OpenCode bridge

- Plugin emits events.
- Pet reacts to thinking/tool/edit/error/success.

### Milestone 4: Claude Code bridge

- Hook command parses Claude hook payloads.
- Settings snippet generated.
- Pet reacts to prompt/tool/waiting/stop/error.

### Milestone 5: polish

- Speech bubble.
- Position/scale settings.
- Hide/sleep behavior.

### Deferred until after phase 1

- Pet registry/gallery.
- Full pet install/publish workflow.
- WebSocket API.
- SDKs.
- MCP server.
- Zip pet import.
- Observer/watch modes.
- GitHub Actions CI/build matrix.
- GitHub Actions product integration.
- Multiple pet formats.
- Complex settings UI.

## Design constraints

- OpenPets must be optional and non-breaking. Integrations should never break the host tool.
- All bridges should silently no-op when the local OpenPets event server is not running.
- Localhost only by default.
- Avoid collecting private prompt/code contents unless user explicitly opts in.
- Event payloads should avoid sending full command output or file content by default.

## Privacy defaults

Send only metadata:

- source
- event type
- state
- tool name
- cwd/project name if needed
- short user-facing message

Do not send by default:

- prompts
- model responses
- file contents
- shell output
- diffs

## Suggested initial demo

```bash
openpets start --pet ./sample-pet
openpets event thinking --message "AI is planning"
openpets event editing --message "Editing files"
openpets event testing --message "Running tests"
openpets event error --message "Tests failed"
openpets event success --message "All tests passed"
```

`openpets event <state>` supports:

```txt
--source <source>
--message <message>
--tool <tool>
--type <type>
```

Defaults:

```txt
source: cli
type: state.<state>
```

Then show OpenCode/Claude Code integration making the same thing happen automatically.
