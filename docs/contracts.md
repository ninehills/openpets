# OpenPets Phase 1 Contracts

This document freezes the phase 1 contracts that parallel implementation lanes must share.

If implementation details change, update this document first. Coding agents should treat this file as the source of truth for phase 1 behavior.

## 1. Product contract

Phase 1 must deliver:

- Electron desktop overlay app.
- macOS, Linux, and Windows support from the beginning.
- Bun workspace monorepo.
- Vite + React renderer.
- Local event server hosted inside Electron main process.
- CLI for starting app, sending events, and installing/printing integrations.
- Codex/Petdex pet directory rendering 1:1.
- Claude Code hooks bridge.
- OpenCode plugin bridge.

Phase 1 must not add:

- WebSocket API.
- MCP server.
- SDKs.
- Pet marketplace/gallery.
- Cloud sync.
- Zip pet import.
- New OpenPets-specific pet format.
- GitHub Actions CI/product integration.
- Separate background daemon.

## 2. Monorepo/package contract

Use Bun workspaces.

Required layout:

```txt
openpets/
  package.json
  bun.lock
  apps/
    desktop/
  packages/
    core/
    pet-format-codex/
    cli/
    # integration templates may live inside packages/cli in phase 1
  examples/
    shell/
    test-runner/
    claude-code/
    opencode/
  docs/
```

Root `package.json`:

```json
{
  "name": "openpets",
  "private": true,
  "workspaces": ["apps/*", "packages/*"]
}
```

Internal packages must depend on each other through workspace references. Phase 1 keeps Claude Code and OpenCode integration templates inside `packages/cli/src/integrations`; split them into `packages/integrations` only if reuse outside the CLI justifies it.

`packages/core` owns:

- event types
- allowed states
- state reducer
- timeout/debounce constants
- OpenPets-to-Codex state mapping
- shared fixtures where useful

All lanes must import shared types/rules from `packages/core` instead of redefining them.

## 3. Runtime/tech contract

Phase 1 stack:

- Desktop: Electron.
- Renderer: Vite + React.
- Language: TypeScript.
- Package manager/runtime for development: Bun.
- Packaging spike candidate: electron-builder.
- Tests: Bun test where practical.

Electron window/server code may use Node-compatible APIs. Do not assume end users have Bun installed unless a later distribution decision explicitly changes this.

## 4. Desktop overlay contract

The overlay is a small transparent frameless always-on-top Electron `BrowserWindow`.

The initial window config is a candidate that must be validated per platform, not a guaranteed final configuration.

Required behavior:

- transparent background
- frameless window
- always-on-top where platform supports it
- no focus stealing where possible
- hidden from taskbar/dock where possible
- basic drag/move
- basic scale support or scale config
- hide/sleep/quit recovery path
- tray/menu or equivalent recovery control where platform supports it
- position persistence
- local event server starts with the app

Click-through is not required in phase 1.

### Platform expectations

Supported target environments for phase 1 validation:

- recent macOS
- Windows 11
- Ubuntu GNOME Wayland
- Ubuntu/X11 or equivalent

Linux Wayland has known Electron limitations around always-on-top and programmatic positioning. If a limitation is observed, document it explicitly and provide best-effort behavior or XWayland guidance. Do not silently claim full Wayland overlay parity if it is not true.

## 5. Local server contract

The local event server runs inside the Electron main process.

Default bind:

```txt
127.0.0.1:4738
```

Required endpoints:

```txt
GET  /health
POST /event
```

No WebSocket endpoint in phase 1.

### `/health`

Response `200 OK` when OpenPets owns the port and is ready:

```json
{
  "app": "openpets",
  "ok": true,
  "version": "0.0.0",
  "ready": true,
  "activePet": "sample-pet"
}
```

Required fields:

- `app`: must equal `"openpets"`
- `ok`: boolean
- `version`: string
- `ready`: boolean
- `activePet`: string or `null`

The CLI uses `app: "openpets"` to distinguish OpenPets from another process on port `4738`.

### Port conflict behavior

- If port `4738` is occupied by OpenPets, reuse the existing instance.
- If port `4738` is occupied by another process, fail clearly.
- Do not choose a random port unless config/discovery is implemented later.

### Single-instance behavior

- Desktop app must use Electron single-instance lock.
- `openpets start` must not create duplicate app/server instances.
- If OpenPets is already running, `openpets start` should reuse/focus/wake the existing instance and return success after `/health` is ready.

## 6. HTTP `/event` contract

Endpoint:

```txt
POST /event
```

Content type:

- accept `application/json` with optional parameters, case-insensitively, such as `application/json; charset=utf-8`
- reject unexpected content types with `415 Unsupported Media Type`

Maximum request body size:

```txt
16 KB
```

Large bodies must be rejected before parsing when possible.

### Event schema

Phase 1 event payload:

```ts
type OpenPetsState =
  | "idle"
  | "thinking"
  | "working"
  | "editing"
  | "running"
  | "testing"
  | "waiting"
  | "waving"
  | "success"
  | "error"
  | "warning"
  | "celebrating"
  | "sleeping";

type OpenPetsEvent = {
  type: string;
  state: OpenPetsState;
  source?: string;
  message?: string;
  tool?: string;
  timestamp?: number;
};
```

Required fields:

- `type`: non-empty string, max 80 chars
- `state`: valid `OpenPetsState`

Optional fields:

- `source`: string, max 80 chars
- `message`: string, max 240 chars, treated as plain text only
- `tool`: string, max 80 chars
- `timestamp`: Unix epoch milliseconds

Rejected by default:

- prompt content
- model response content
- file contents
- diffs
- shell output
- raw hook payloads
- large arbitrary metadata objects
- `cwd` unless a later explicit privacy decision adds it

Unknown extra fields should be ignored or stripped, not forwarded to renderer.

### HTTP status codes

- `200 OK`: event accepted.
- `400 Bad Request`: invalid JSON or schema validation failed.
- `404 Not Found`: unknown endpoint.
- `405 Method Not Allowed`: wrong HTTP method.
- `413 Payload Too Large`: body exceeds max size.
- `415 Unsupported Media Type`: content type is not accepted JSON.
- `500 Internal Server Error`: unexpected server error.

Manual CLI commands should surface non-2xx errors. Agent bridges should fail silently/no-op unless debug mode is enabled.

Success response body:

```json
{
  "ok": true,
  "state": "thinking"
}
```

Error response body:

```json
{
  "ok": false,
  "error": "Invalid event state"
}
```

## 7. Local API security contract

Server must:

- bind only to `127.0.0.1`
- expose no CORS headers by default
- reject browser-origin requests unless explicitly allowed later
- require JSON content type for `POST /event`
- reject large bodies
- validate event schema
- strip unknown fields before renderer IPC

Renderer must treat event messages as plain text only.

No local API token is required in phase 1 unless implementation remains simple and does not derail milestones.

## 8. Electron security contract

Renderer `webPreferences` must use:

```ts
contextIsolation: true
nodeIntegration: false
nodeIntegrationInWorker: false
nodeIntegrationInSubFrames: false
sandbox: true
webSecurity: true
allowRunningInsecureContent: false
experimentalFeatures: false
```

Rules:

- Use preload + `contextBridge` for renderer capabilities.
- Never expose raw `ipcRenderer` to renderer.
- Validate all IPC payloads in main process.
- Use a minimal preload API.
- Load no remote content in phase 1.
- Add a Content Security Policy.
- Block unexpected navigation and window creation.
- Prefer custom protocol or tightly validated asset loading over broad `file://` access.
- Restrict pet asset loading to selected pet directory or bundled sample assets.

## 9. State reducer contract

Phase 1 uses one global pet state. Session-specific state is deferred.

`waving` is a public OpenPets state in phase 1. It means active attention/greeting/request, while `waiting` means passive waiting.

State categories:

```txt
long-running: idle, thinking, working, editing, running, testing, waiting, waving, sleeping
temporary: success, error, warning, celebrating
```

Timing constants to implement in `packages/core`:

```txt
duplicateDebounceMs: 250
successDurationMs: 1800
errorDurationMs: 2400
warningDurationMs: 2200
celebratingDurationMs: 2200
```

Rules:

- Duplicate same-state events inside `duplicateDebounceMs` are ignored.
- `waiting` persists until any accepted non-`waiting` event arrives, except ignored duplicate events.
- `waving` persists until another accepted event arrives, except ignored duplicate events.
- `sleeping` persists until any accepted non-`sleeping` event arrives. Agent/tool events wake the pet in phase 1.
- Temporary states show for their minimum duration.
- Higher-priority temporary states override lower-priority temporary states immediately.
- Lower-priority temporary states are ignored while a higher-priority temporary state is active.
- Long-running states during an active temporary state update fallback state only; they do not immediately render.
- When no temporary state is active, any accepted long-running event becomes the rendered state immediately, except for duplicate debounce and the explicit `waiting`/`waving`/`sleeping` persistence rules above.
- After a temporary state expires, return to the previous long-running state if known, otherwise `idle`.

Priority order:

```txt
error > warning > celebrating > success > waving > waiting > testing > editing > running > working > thinking > idle > sleeping
```

While a temporary state is active, lower-priority long-running events are remembered as the fallback but not immediately rendered.

Definitions:

- **accepted event:** an event that passes schema validation and is not ignored by duplicate debounce.
- **fallback state:** the latest accepted long-running state to return to after a temporary state expires.
- **user controls:** hide/show/sleep/quit UI or CLI actions. `sleeping` can be entered by event or user control; hide/show/quit are app visibility controls, not reducer states.

## 10. Codex/Petdex pet contract

Phase 1 supports local unpacked pet directories only.

Required structure:

```txt
sample-pet/
├── pet.json
└── spritesheet.webp or spritesheet.png
```

Zip import is deferred.

### `pet.json`

Required/accepted fields:

```json
{
  "id": "sample-pet",
  "displayName": "Sample Pet",
  "description": "A Codex-compatible pet."
}
```

Field rules:

- `id`: optional string in phase 1; if missing, derive from directory name
- `displayName`: optional string; if missing, use `id` or directory name
- `description`: optional string

### Spritesheet

Accepted filenames, in priority order:

```txt
spritesheet.webp
spritesheet.png
```

Expected dimensions:

```txt
1536 × 1872
```

Frame contract:

```txt
columns: 8
rows: 9
frame width: 192
frame height: 208
```

Phase 1 should warn or fail clearly if dimensions are wrong. Use a known-good bundled sample pet for default fallback.

### Codex state rows

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

### OpenPets-to-Codex mapping

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

CSS sprite rendering is required. Canvas rendering is deferred.

## 11. CLI contract

Required phase 1 commands:

```bash
openpets start
openpets start --pet ./sample-pet
openpets event <state>
openpets show
openpets hide
openpets sleep
openpets quit
openpets hook claude-code
openpets integrate claude-code --print
openpets integrate claude-code --install
openpets integrate opencode --print
openpets integrate opencode --install
```

### `openpets start`

Behavior:

- launch or reuse Electron app
- wait for `/health` readiness
- fail clearly if port belongs to another process
- do not launch duplicate instance

Startup timeout:

```txt
5000ms
```

### `openpets start --pet <path>`

Behavior:

- path must be local directory
- zip paths are rejected in phase 1
- stores absolute normalized pet path in config
- launches/reuses Electron app
- active pet becomes the selected pet

If OpenPets is already running, `openpets start --pet <path>` must hand the absolute pet path to the existing Electron instance through Electron second-instance argv handling. No extra HTTP control endpoint is added in phase 1.

If omitted, load last configured pet or bundled sample pet.

### `openpets event <state>`

Behavior:

- sends `POST /event` to local server
- source defaults to `cli`
- type defaults to `state.<state>`
- direct/manual CLI use shows errors visibly

Supported flags:

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

Example:

```bash
openpets event testing
bun test && openpets event success || openpets event error
```

### Bridge silent mode

Bridge commands must no-op silently when OpenPets is unavailable and should exit `0` unless debug mode is enabled.

Debug mode may emit diagnostics, but OpenPets unavailability should still not break Claude Code or OpenCode host flows.

Debug mode:

```bash
OPENPETS_DEBUG=1
```

### Recovery commands

Required minimum recovery commands:

```bash
openpets show
openpets hide
openpets sleep
openpets quit
```

Behavior:

- `show`: asks running app to show overlay.
- `hide`: asks running app to hide overlay.
- `sleep`: sends a `sleeping` event and keeps the app recoverable through `show`, tray/menu, or restarting `openpets start`.
- `quit`: asks running app to quit cleanly.

These commands may use Electron second-instance argv handling in phase 1. No extra HTTP control endpoint is required unless the implementation explicitly updates this contract.

If OpenPets is unavailable:

- `show` may launch/reuse the app and clear hidden state.
- `hide`, `sleep`, and `quit` should fail clearly for manual CLI use.
- Bridge silent-mode behavior does not apply to manual recovery commands.

## 12. Config/storage contract

Use a shared config/path helper that works from both Electron and the CLI without Electron-only APIs.

Store JSON config in a platform-appropriate user config path chosen by the shared helper.

Tests may override the config directory with:

```txt
OPENPETS_CONFIG_DIR
```

Config shape:

```json
{
  "petPath": "/absolute/path/to/sample-pet",
  "position": { "x": 100, "y": 100 },
  "scale": 1,
  "hidden": false
}
```

Rules:

- Store absolute normalized pet paths.
- Phase 1 uses fixed port `4738`; configurable ports are deferred.
- Quote generated paths in integration snippets.
- Test paths with spaces.
- No database in phase 1.

## 13. Claude Code bridge contract

Command:

```bash
openpets hook claude-code
```

Behavior:

- read JSON from stdin
- parse defensively
- never persist/log/send raw hook payload
- map hook to a metadata-only OpenPets event
- POST to local `/event`
- abort HTTP after 250–500ms
- if OpenPets unavailable, exit `0`
- never launch Electron from hook mode
- emit no stdout in hook mode
- emit no decision JSON
- emit stderr only when `OPENPETS_DEBUG=1`

Mapping:

```txt
UserPromptSubmit                         → thinking
PreToolUse Edit/Write/MultiEdit          → editing
PreToolUse Bash with test-like command   → testing
PreToolUse Bash                          → running
PermissionRequest / permission prompt    → waving
normal input wait / idle prompt          → waiting
Stop                                     → success
StopFailure / hook failure payload       → error
```

Integration commands:

```bash
openpets integrate claude-code --print
openpets integrate claude-code --install
```

Rules:

- `--print` is default/safest behavior.
- `--install` must back up and merge safely.
- `--install` must not clobber existing user/project settings silently.
- Phase 1 `--install` defaults to project-local installation in the current working directory.
- Claude Code install target: `.claude/settings.local.json` by default.
- User-global Claude install is deferred unless an explicit `--global` flag is added later.
- Generated commands must quote paths with spaces.

## 14. OpenCode bridge contract

Integration commands:

```bash
openpets integrate opencode --print
openpets integrate opencode --install
```

OpenCode plugin must be self-contained and must not depend on OpenPets workspace packages. Additional dependencies should be avoided in phase 1.

Minimum required signals:

```txt
session.status
tool.execute.before
tool.execute.after
permission.asked
session.error
```

Optional signals:

```txt
message.part.updated
file.edited
```

Mapping:

```txt
session.status busy                  → thinking
session.status idle                  → idle
tool.execute.before Bash test-like   → testing
tool.execute.before Bash             → running
tool.execute.before edit/patch       → editing
tool.execute.after success           → success
tool.execute.after error             → error
permission.asked                     → waving
session.error                        → error
message.part.updated reasoning       → thinking  optional
file.edited                          → editing   optional
```

Rules:

- mapping lives in one small adapter/table
- catch all errors
- short HTTP timeout, target 250–500ms
- no-op if OpenPets unavailable
- throttle high-frequency optional signals
- send metadata only
- do not overwrite existing plugin/config silently on install
- Phase 1 `--install` defaults to project-local installation in the current working directory.
- OpenCode install target: `.opencode/plugins/openpets.ts` by default.
- Global OpenCode install is deferred unless an explicit `--global` flag is added later.

## 15. Integration install contract

For both Claude Code and OpenCode:

- `--print` outputs instructions/snippet only.
- `--install` mutates files only after explicit user request.
- phase 1 `--install` defaults to project-local installation in the current working directory.
- `--install` creates backups before modifying existing files.
- `--install` merges rather than clobbers where possible.
- If safe merge is not possible, abort with clear instructions.

## 16. Validation contract

Before broad parallel implementation:

1. Freeze this contract.
2. Secure platform test environments.
3. Create shared fixtures.

Phase 1 completion requires:

- manual overlay demo works on macOS, Linux, and Windows
- `/health` returns `app: "openpets"`
- `openpets event` updates renderer
- sample pet renders correctly
- state reducer spam test passes
- Claude bridge no-ops safely when unavailable
- OpenCode bridge no-ops safely when unavailable
- shell demo works:

```bash
openpets event testing
bun test && openpets event success || openpets event error
```

## 17. Parallel lane boundaries

Parallel lanes may start after this contract is accepted.

Lanes:

- desktop/platform
- pet renderer/format
- CLI
- Claude Code bridge
- OpenCode bridge
- validation/docs

All lanes communicate through:

- `packages/core` types/reducer/mapping
- local HTTP API contract
- shared pet fixtures

No lane should invent additional states, event fields, endpoints, or pet formats without updating this document first.
