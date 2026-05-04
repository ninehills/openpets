# OpenPets Technical Derisking Research

This document summarizes online/current-docs research for the highest-risk phase 1 technical decisions.

Phase 1 requirements:

- Electron + TypeScript + Bun workspaces
- Vite + React renderer
- macOS, Linux, and Windows support
- transparent always-on-top pet overlay
- local HTTP event API in Electron main process
- CLI
- Codex/Petdex spritesheet rendering
- Claude Code hooks bridge
- OpenCode plugin bridge

## Highest-priority derisking order

Do these before broad implementation:

1. Build an Electron transparent always-on-top overlay spike.
2. Validate overlay behavior on macOS, Windows, Linux X11, and Linux Wayland.
3. Implement `/health` and `POST /event` in Electron main process.
4. Confirm `openpets start` lifecycle and single-instance behavior.
5. Render a known-good Codex/Petdex pet with CSS sprites.
6. Add state reducer spam/flicker tests.
7. Verify Claude Code hook and OpenCode plugin bridges with fixture payloads.

## 1. Electron overlay research

### Recommendation

Use Electron `BrowserWindow` as a small transparent frameless always-on-top window.

Initial candidate config to validate during the overlay spike:

```ts
const petWindow = new BrowserWindow({
  width: 192,
  height: 208,
  transparent: true,
  frame: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  focusable: false,
  resizable: false,
  movable: true,
  hasShadow: false,
  backgroundColor: "#00000000",
  show: false,
  fullscreenable: false,
  webPreferences: {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    // Only set this to false if visible animation throttling is observed.
    // Leaving Electron's default is better for CPU/battery.
    // backgroundThrottling: false,
  },
})
```

Platform-specific notes:

- **macOS:** test always-on-top levels such as `"floating"` and `"pop-up-menu"`; only use panel-like behavior if validated in the current Electron version.
- **Windows:** transparent/frameless/always-on-top is generally supported, but HiDPI and mixed-scale multi-monitor behavior need early testing.
- **Linux X11:** is more likely to support always-on-top and positioning than Wayland, but must still be validated per window manager.
- **Linux Wayland:** major limitation. Electron/Wayland does not reliably support app-controlled always-on-top, programmatic positioning, or cursor position APIs. Need best-effort support or XWayland fallback guidance.

### Important phase 1 decision

Click-through is **not required** for phase 1 unless explicitly added later. It adds platform complexity, especially on Linux/Wayland.

### Overlay smoke checklist

- Window opens transparent.
- No frame/title bar.
- Stays on top on supported environments.
- Does not steal focus.
- Hidden from taskbar/dock where possible.
- Can drag/move.
- Scale works.
- Hide/sleep/quit works.
- Position survives restart.
- HiDPI/multi-monitor behavior is acceptable.
- Linux Wayland limitations are documented if present.

## 2. Electron + Bun packaging / CLI research

### Recommendation

Use:

- Bun workspaces for development.
- Electron desktop app in `apps/desktop`.
- TypeScript CLI package.
- `electron-builder` as the first phase 1 packaging spike candidate.

Research result:

- `electron-builder` appears to have more explicit Bun support and mature packaging targets.
- Electron Forge Bun support exists but appears less mature.
- If Bun workspace/CLI integration is awkward with electron-builder, fall back to npm-compatible scripts or Electron Forge.
- End users should **not** need Bun if the app/CLI is packaged correctly.

### CLI distribution options

Preferred direction:

- Dev: run CLI with Bun.
- Distribution: compile CLI with `bun build --compile` or ship a Node-compatible bundled JS CLI.

Bun compiled CLI caveats:

- outputs are per-platform and per-architecture
- macOS builds may still need signing/notarization for trust
- Windows binaries need metadata/signing decisions
- CPU target/baseline compatibility should be verified on older machines if supporting them

Need to freeze before coding:

- Is Bun required for end users? Recommendation: **no**.
- Does packaged app include CLI? Decide during packaging spike.
- How does `openpets start` find the packaged Electron app?
- What does `openpets start` do in dev vs packaged mode?

### electron-builder targets to consider

- macOS: `dmg`, `zip`
- Windows: `nsis`, `portable`
- Linux: `AppImage`, `deb`

Polished installers/signing can come later, but expected warnings must be documented if builds are unsigned.

## 3. Local HTTP server and lifecycle research

### Recommendation

Host the local HTTP server inside Electron main process.

Flow:

```txt
openpets start
  -> launches Electron app
  -> Electron main binds 127.0.0.1:4738
  -> CLI/bridges POST /event
  -> main validates event
  -> main updates reducer
  -> main sends state to renderer via IPC
```

Required endpoints:

```txt
GET  /health
POST /event
```

`/health` should return:

```json
{
  "app": "openpets",
  "ok": true,
  "version": "0.0.0",
  "activePet": "sample-pet",
  "ready": true
}
```

Port behavior:

- Default bind: `127.0.0.1:4738`.
- If `4738` is occupied by OpenPets, reuse it.
- If `4738` is occupied by another process, fail clearly.
- Do not pick a random port unless discovery/config is implemented.

Single-instance behavior:

- Use Electron single-instance lock.
- `openpets start` should not launch duplicate app instances.
- `openpets event` should fail visibly for manual CLI use if OpenPets is unavailable.
- Bridges should fail silently/no-op if OpenPets is unavailable.

## 4. Electron security research

### Mandatory baseline

Electron renderer/security config:

```ts
webPreferences: {
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  preload,
}
```

Rules:

- Never expose `ipcRenderer` directly.
- Use `contextBridge` with a tiny preload API.
- Validate IPC senders.
- Validate IPC payloads in preload and main process.
- Treat event `message` as plain text only.
- Do not load remote content in phase 1.
- Use CSP.
- Block unexpected navigation/window creation.

### Local asset loading

Avoid broad arbitrary `file://` exposure.

Preferred:

- load renderer app normally via Vite/dev or packaged files
- restrict pet asset loading to selected pet directory
- use path traversal checks
- consider a custom protocol for pet assets if needed

Security rule:

```txt
selected pet directory is the only user-selected file tree renderer may access
```

### Local HTTP API protections

For `POST /event`:

- bind only to `127.0.0.1`
- require `Content-Type: application/json`
- reject unexpected content types
- reject browser-origin requests unless explicitly allowed
- no CORS headers by default
- reject large bodies before parsing
- validate schema
- metadata only by default

Optional token can be added later if simple, but do not let token plumbing derail phase 1.

## 5. Claude Code integration research

### Current recommendation

Implement:

```bash
claude-pets hook
```

Behavior:

- read hook JSON from stdin
- parse defensively
- map to OpenPets event
- POST metadata-only event to local server
- no-op quickly if OpenPets is unavailable
- no stdout/stderr unless `OPENPETS_DEBUG=1`
- never launch Electron from a hook
- always exit `0` when OpenPets is unavailable
- never emit stdout in hook mode
- never emit decision JSON
- internally abort HTTP requests after 250–500ms

Timeout target:

```txt
250–500ms
```

### Claude Code setup

Use generated settings snippets via:

```bash
claude-pets print
claude-pets install
```

Default should be `--print`. `--install` must back up and merge safely.

Relevant hook signals:

- `UserPromptSubmit` → `thinking`
- `PreToolUse` `Edit`/`Write` → `editing`
- `PreToolUse` `Bash` → `running` or `testing`
- `PermissionRequest` / permission notification → `waving`
- normal input wait / idle prompt → `waiting`
- `Stop` → `success`/`celebrating`
- failures/errors → `error`

Research note:

- Claude hook APIs have changed over time.
- Fixture tests are required.
- Use metadata only; no prompts, responses, diffs, shell output, or file contents.

## 6. OpenCode integration research

### Current recommendation

Generate a self-contained OpenCode plugin.

Commands:

```bash
opencode-pets print-plugin
opencode-pets install
```

Default should be `--print`. `--install` must not overwrite silently.

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

Mapping should live in one small adapter/table so event names/payload shapes are easy to update.

Plugin rules:

- dependency-free if possible
- catch all errors
- short HTTP timeout
- no-op if OpenPets unavailable
- throttle high-frequency optional signals
- send metadata only

## 7. Immediate research-backed decisions

Lock these before coding:

1. Electron for phase 1 desktop.
2. Bun workspaces for development.
3. Vite + React renderer.
4. electron-builder for packaging spike.
5. Local server hosted in Electron main process.
6. `GET /health` and `POST /event` only for phase 1.
7. Directory-only pet input for phase 1.
8. CSS sprite renderer, not canvas.
9. Click-through deferred unless explicitly needed.
10. Linux Wayland support is tested and documented as best-effort if Electron limitations apply.

## 8. Follow-up docs to create before coding

Create a contract/spec doc that freezes:

- event schema
- state reducer timing and priorities
- HTTP API behavior/status codes
- pet directory contract and validation errors
- CLI lifecycle behavior
- dev vs packaged command behavior
- integration snippet install/merge behavior
- platform validation matrix

Suggested file:

```txt
docs/contracts.md
```

## Key sources

- Electron BrowserWindow API: https://www.electronjs.org/docs/latest/api/browser-window
- Electron Frameless Windows: https://www.electronjs.org/docs/latest/tutorial/custom-window-styles
- Electron Security: https://www.electronjs.org/docs/latest/tutorial/security
- Electron Context Isolation: https://www.electronjs.org/docs/latest/tutorial/context-isolation
- Electron Protocol API: https://www.electronjs.org/docs/latest/api/protocol
- Electron Distribution: https://www.electronjs.org/docs/latest/tutorial/application-distribution
- Bun Workspaces: https://bun.sh/docs/install/workspaces
- Bun Executables: https://bun.com/docs/bundler/executables
- electron-builder: https://www.electron.build/
- Claude Code Hooks: https://code.claude.com/docs/en/hooks
- OpenCode Plugins: https://opencode.ai/docs/plugins/
