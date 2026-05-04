# OpenPets Implementation Risks

This document tracks the highest-impact risks that could cause implementation trouble, scope changes, or spec changes during phase 1.

Phase 1 target:

- Electron + TypeScript + Bun workspace
- macOS, Linux, and Windows support from the beginning
- transparent always-on-top desktop pet overlay
- local HTTP event API
- CLI
- Codex/Petdex pet rendering 1:1
- Claude Code hooks bridge
- OpenCode plugin bridge

## Risk levels

- **Critical:** could force architecture/spec changes or block launch.
- **High:** likely to cause implementation delays or degraded phase 1 support.
- **Medium:** manageable, but should be planned around.

## Likelihood levels

- **High:** expected to happen without deliberate mitigation.
- **Medium:** plausible during phase 1.
- **Low:** unlikely, but expensive if it happens.

## Severity / likelihood summary

| Risk | Severity | Likelihood |
|---|---:|---:|
| Cross-platform transparent overlay behavior | Critical | High |
| Electron + Bun packaging/distribution | Critical | Medium-High |
| `openpets start` lifecycle and single-instance behavior | Critical | High |
| Event/state flicker from noisy integrations | High | High |
| Claude Code hook API changes or setup friction | High | Medium-High |
| OpenCode plugin API changes or event shape drift | High | Medium |
| Codex/Petdex format edge cases | High | Medium |
| Local HTTP API security/privacy | High | Medium |
| Cross-platform file/config paths | Medium | High |
| Bridge failure should not break host tools | High | Medium-High |
| Product UX annoyance | High | High |
| Parallel-agent implementation drift | Critical | High |
| Platform validation environment availability | Critical | High |
| Code signing, notarization, and OS trust warnings | High | High |
| Electron renderer/security boundary | High | Medium |
| Performance, battery, and resource usage | High | Medium-High |
| Ambitious phase-1 scope compression | Critical | High |
| Dependency/version pinning drift | Medium | High |

## 1. Cross-platform transparent overlay behavior

**Level:** Critical
**Likelihood:** High

The pet overlay depends on platform-specific desktop behavior:

- transparent windows
- frameless windows
- always-on-top behavior
- drag/move interactions
- focus behavior
- taskbar/dock behavior
- multi-monitor placement

This is especially risky on Linux because X11 and Wayland behave differently, and window managers/compositors vary.

### What could go wrong

- Transparency does not work on some Linux environments.
- Always-on-top is ignored or inconsistent.
- Click/drag behavior interferes with normal app usage.
- Window appears in taskbar/dock when it should not.
- Overlay steals focus from editor/terminal.
- Multi-monitor coordinates are wrong.
- Windows/macOS require different flags or fallback behavior.

### Possible plan/spec changes

- Add per-platform fallback modes.
- Disable click-through initially.
- Use a small normal always-on-top window instead of a true overlay on some platforms.
- Support Linux X11 first and mark Wayland as best-effort.
- Add tray/menu controls earlier than planned.

### Mitigation

- Build the overlay spike before integrations.
- Test macOS, Windows, Linux X11, and Linux Wayland during milestone 1.
- Define the phase 1 platform matrix explicitly.
- Validate HiDPI scaling and multi-monitor behavior.
- Test hide/quit from every platform.
- Treat click-through as not required for phase 1 unless explicitly added later.
- Document Linux Wayland limitations immediately instead of discovering them after integrations.
- Keep overlay small, not fullscreen.
- Add hide/quit early.
- Keep platform-specific window code isolated.

## 2. Electron + Bun packaging/distribution

**Level:** Critical
**Likelihood:** Medium-High

The project prefers Bun for workspace/runtime, but Electron packaging and CLI distribution are usually Node-oriented.

### What could go wrong

- End users need Bun installed unexpectedly.
- CLI cannot reliably launch the packaged Electron app.
- Packaged app cannot find bundled assets or sample pet.
- `openpets start` works in dev but not packaged mode.
- Windows PATH/global command behavior differs from macOS/Linux.
- electron-builder/Electron Forge assumptions conflict with Bun scripts.
- Bun compiled CLI outputs are per-platform/per-architecture.
- macOS signing/notarization and Windows binary metadata/signing affect CLI trust.
- CPU target/baseline compatibility for compiled CLIs is unclear until tested.

### Possible plan/spec changes

- Use Bun for development but bundle CLI to plain JS for distribution.
- Require separate desktop app install plus CLI install.
- Defer polished installer/PATH behavior.
- Use npm-compatible package metadata even if Bun is the package manager.
- Prefer a Node-compatible bundled JS CLI if Bun compiled executable caveats block distribution.

### Mitigation

- Define dev vs packaged behavior before coding.
- Decide whether phase 1 produces dev builds, packaged artifacts, or installers.
- Decide whether end users need Bun installed.
- Decide whether the CLI is bundled JS, a standalone executable, or shipped with the desktop app.
- Keep CLI thin: mostly HTTP client + app launcher.
- Use Node-compatible APIs in CLI and Electron main process.
- Test `openpets start` lifecycle in dev and packaged builds early.
- Do not assume users have Bun unless explicitly decided.

## 3. `openpets start` lifecycle and single-instance behavior

**Level:** Critical
**Likelihood:** High

The local event server lives inside the desktop app. This makes `openpets start` central to everything.

### What could go wrong

- Multiple OpenPets instances start and fight over port `4738`.
- Port is already in use by another process.
- CLI cannot tell whether OpenPets is already running.
- App starts but HTTP server fails silently.
- CLI exits before Electron is ready.
- `openpets event` races with startup.

### Possible plan/spec changes

- Add `openpets status` earlier.
- Add readiness polling to `openpets start`.
- Add port override support earlier.
- Add single-instance lock.
- Move local server to a separate background process later if needed.

### Mitigation

- Implement Electron single-instance lock.
- Define port conflict behavior.
- If port `4738` is occupied by OpenPets, reuse it.
- If port `4738` is occupied by another process, fail with a clear error.
- Do not choose a random port unless discovery/config is implemented.
- Add `/health` endpoint.
- `/health` should return app version, server readiness, and active pet status.
- Make `openpets start` wait until `/health` passes or timeout.
- `openpets event` should fail visibly for manual CLI use, while bridges should use silent mode.
- Keep default server bound to `127.0.0.1` only.

## 4. Event/state flicker from noisy integrations

**Level:** High
**Likelihood:** High

Claude Code and OpenCode can emit many events quickly. Without strict state rules, the pet may flicker and feel broken.

### What could go wrong

- `success` appears for a few milliseconds then gets overwritten by `working`.
- `error` is hidden by follow-up status events.
- Pet rapidly switches between `thinking`, `working`, and `idle`.
- Duplicate events overwhelm renderer.
- Agent bridge and shell events fight each other.

### Possible plan/spec changes

- Add event priorities.
- Add source/session-specific state.
- Add minimum display durations.
- Add queueing or cooldown logic.

### Mitigation

- Freeze reducer rules before bridge work.
- Choose exact minimum display durations before implementation.
- Choose exact duplicate debounce interval before implementation.
- Define a state priority table.
- Phase 1 uses one global pet state unless session-specific state is explicitly added.
- Implement minimum display duration for `success`, `error`, and `celebrating`.
- Make `waiting` sticky.
- Debounce duplicate same-state events.
- Keep integration-side debouncing too.

## 5. Claude Code hook API changes or setup friction

**Level:** High
**Likelihood:** Medium-High

Claude Code support depends on hooks/settings behavior. This can change, and setup can be sensitive because users do not want tools modifying config unexpectedly.

### What could go wrong

- Hook payload shape differs by version.
- Hook payloads may contain prompts, file contents, diffs, shell commands, or other sensitive data.
- Hook events do not fire when expected.
- User/project settings merge is tricky.
- `--install` risks clobbering existing hooks.
- Hooks block or slow Claude Code if bridge command is slow.
- Claude Code users distrust automatic config edits.

### Possible plan/spec changes

- Make Claude integration print-only for launch.
- Require manual config copy/paste.
- Support fewer hook events initially.
- Add version-specific adapters.

### Mitigation

- Default to `--print`.
- `--install` must create backups and merge safely.
- Bridge must no-op quickly if OpenPets is unavailable.
- Hook command should target a 250–500ms timeout budget.
- Hook command should never launch Electron.
- Hook command should emit no stdout/stderr unless `OPENPETS_DEBUG=1`.
- Generated commands must quote paths with spaces correctly.
- Add fixture tests for hook payloads.
- Do not send prompt/model/file content by default.
- Never persist, log, or forward raw hook payloads.

## 6. OpenCode plugin API changes or event shape drift

**Level:** High
**Likelihood:** Medium

OpenCode support depends on plugin events and payload shapes. The plan already requires the mapping to be easy to change.

### What could go wrong

- Event names change.
- Payload shape differs across OpenCode versions.
- Plugin load path differs by platform/config.
- Plugin errors affect OpenCode.
- High-frequency events create performance issues.

### Possible plan/spec changes

- Support only minimum required signals initially.
- Generate a simpler plugin with fewer events.
- Move mapping into versioned adapter templates.

### Mitigation

- Minimum required signals only:
  - `session.status`
  - `tool.execute.before`
  - `tool.execute.after`
  - `permission.asked`
  - `session.error`
- Keep optional signals optional.
- Keep plugin self-contained.
- Plugin should be dependency-free.
- Handle missing or changed `fetch`/`AbortController` defensively.
- `--install` should not overwrite existing plugins/config silently.
- Throttle high-frequency `message.part.updated` events if enabled.
- Catch all errors.
- Keep event mapping in one adapter/table.

## 7. Codex/Petdex format edge cases

**Level:** High
**Likelihood:** Medium

The basic format is simple, but real pet packs may vary.

### What could go wrong

- Spritesheet dimensions are wrong.
- `spritesheet.webp` missing but `spritesheet.png` exists, or vice versa.
- `pet.json` fields are missing or malformed.
- WebP rendering differs or fails on some platform/Electron version.
- Pixel art appears blurry due to CSS scaling.
- Some packs use assumptions not captured by Petdex docs.

### Possible plan/spec changes

- Add stricter validation.
- Add PNG-only fallback recommendation.
- Add a pet normalization/import step later.
- Add support for more manifest fields later.

### Mitigation

- Phase 1 supports local directories only.
- Phase 1 supports unpacked local pet directories containing `pet.json` and `spritesheet.webp` or `spritesheet.png`.
- Zip import is deferred unless explicitly required later.
- Validate required files clearly.
- Validate expected dimensions where possible.
- Use CSS `image-rendering: pixelated`.
- Include known-good bundled sample pet.
- Test with several Petdex pets early.

## 8. Local HTTP API security/privacy

**Level:** High
**Likelihood:** Medium

The local API is intentionally simple, but any local process may be able to send events.

### What could go wrong

- Browser pages or local processes spam pet events.
- Large payloads cause memory/performance problems.
- Integrations accidentally send prompts, diffs, shell output, or file paths.
- CORS settings accidentally expose API to websites.
- Future token/auth changes require spec updates.

### Possible plan/spec changes

- Add local API token earlier.
- Reject all browser-origin requests.
- Add stricter payload size limits.
- Add source allowlist.

### Mitigation

- Bind only to `127.0.0.1`.
- No CORS headers by default.
- Require JSON content types such as `application/json` or `application/json; charset=utf-8`.
- Reject unexpected content types.
- Reject browser-origin requests unless explicitly allowed.
- Validate schema.
- Reject large bodies before parsing.
- Metadata-only integrations.
- Avoid `cwd` by default.
- Consider optional local token if implementation stays simple.

## 9. Cross-platform file/config paths

**Level:** Medium
**Likelihood:** High

OpenPets needs config and pet paths to work across OSes.

### What could go wrong

- Config path differs between CLI and Electron app.
- Windows paths break plugin snippets.
- Spaces in paths break hook commands.
- Packaged app cannot access pet path due to permissions.
- Relative pet paths resolve differently from CLI vs app.

### Possible plan/spec changes

- Store absolute pet paths only.
- Add config path helper package.
- Add path quoting utilities for generated snippets.

### Mitigation

- Use a shared config/path helper.
- Store absolute normalized paths.
- Quote paths in generated integration snippets.
- Test paths with spaces on Windows/macOS.
- Test shell-specific quoting for Bash, Zsh, PowerShell, and Windows command execution where relevant.

## 10. Bridge failure should not break host tools

**Level:** High
**Likelihood:** Medium-High

Claude Code and OpenCode integrations must never degrade the host tool experience.

### What could go wrong

- Hook command throws and blocks Claude Code.
- Plugin throws and breaks OpenCode plugin loading.
- Network request hangs when OpenPets is not running.
- Integration logs noisy errors.

### Possible plan/spec changes

- Add very short timeouts.
- Make all bridge commands silent by default.
- Separate debug mode from normal mode.

### Mitigation

- Catch all bridge errors.
- Use short HTTP timeouts, target 250–500ms.
- Silent no-op if OpenPets unavailable.
- Bridge commands should exit 0 when OpenPets is unavailable.
- Add `OPENPETS_DEBUG=1` for diagnostics.

## 11. Product UX annoyance

**Level:** High
**Likelihood:** High

Even if technically working, a desktop pet can become annoying.

### What could go wrong

- Pet blocks editor or terminal content.
- Animation is distracting.
- Always-on-top feels intrusive.
- Users cannot quickly hide/quit.
- Hidden-from-taskbar, frameless, or non-focusable windows have no reliable recovery path.
- State messages leak too much information on screen.

### Possible plan/spec changes

- Add sleep mode earlier.
- Add opacity/scale controls earlier.
- Add click-through mode later.
- Disable speech bubbles by default.

### Mitigation

- Basic hide/sleep/quit in phase 1.
- Provide a reliable recovery path via tray/menu and/or CLI command.
- Basic drag/scale in phase 1.
- Conservative default size/position.
- Keep messages short and optional.
- Support reduced-motion behavior.
- Pause animation when hidden/sleeping.

## 12. Parallel-agent implementation drift

**Level:** Critical
**Likelihood:** High

The project will be implemented with multiple coding agents. Parallelization helps, but only if contracts are frozen.

### What could go wrong

- CLI and desktop disagree on event schema.
- Renderer expects states that core does not define.
- Integrations emit fields the server rejects.
- Pet loader and renderer disagree on asset paths.
- Platform lane changes architecture without integration lanes knowing.

### Possible plan/spec changes

- Add a dedicated contract/spec document before coding.
- Require all lanes to depend on `packages/core` types.
- Add fixture tests shared across lanes.

### Mitigation

- Do a contract-freeze pass before implementation.
- Shared `packages/core` owns event schema, states, mapping, reducer.
- Shared fixtures for events and pet packs.
- Parallel lanes communicate only through shared schema + HTTP API.

## 13. Platform validation environment availability

**Level:** Critical
**Likelihood:** High

OpenPets cannot honestly claim macOS, Linux, and Windows support unless those platforms are tested early. CI and local-only testing are not enough for transparent desktop overlay behavior.

### What could go wrong

- No access to real macOS, Windows, or Linux desktop environments during milestone 1.
- CI runners build successfully but do not validate real overlay behavior.
- Linux Wayland and X11 behave differently.
- HiDPI or multi-monitor issues are discovered late.
- Windows/macOS packaging works, but actual overlay behavior is poor.

### Possible plan/spec changes

- Mark specific environments as best-effort.
- Delay launch until platform testers confirm behavior.
- Narrow the initial supported Linux environments.

### Mitigation

- Require a manual smoke checklist per OS during milestone 1.
- Nominate a platform owner/tester per OS.
- Test at least:
  - recent macOS
  - Windows 11
  - Ubuntu GNOME Wayland
  - Ubuntu/X11 or equivalent
- Do not mark phase 1 complete until all three platforms pass the smoke checklist.

## 14. Code signing, notarization, and OS trust warnings

**Level:** High
**Likelihood:** High

Electron apps often hit platform trust friction, especially macOS quarantine/notarization and Windows SmartScreen warnings.

### What could go wrong

- macOS blocks or warns on unsigned builds.
- Windows SmartScreen scares users away.
- Linux package format expectations differ by distro.
- Users confuse trust warnings with malware risk.

### Possible plan/spec changes

- Ship unsigned beta builds with explicit documentation.
- Delay public release until signing/notarization is solved.
- Defer polished installers and provide dev builds first.

### Mitigation

- Decide whether phase 1 ships unsigned beta builds or signed installers.
- Document expected warnings if unsigned.
- Avoid claiming polished/high-trust install UX if install warnings remain.
- Keep release/install expectations explicit in README.

## 15. Electron renderer/security boundary

**Level:** High
**Likelihood:** Medium

The Electron app loads local pet assets and exposes IPC between the main process and renderer. Electron security defaults need to be explicit.

### What could go wrong

- Renderer gets Node access accidentally.
- Pet asset paths expose arbitrary local files.
- Preload API exposes too much capability.
- Future UI loads remote content accidentally.
- Local HTTP events inject unsafe text into the renderer.

### Possible plan/spec changes

- Add stricter asset loading rules.
- Add message sanitization.
- Add a dedicated preload API boundary earlier.

### Mitigation

- Use `contextIsolation: true`.
- Use `nodeIntegration: false`.
- Load no remote content in phase 1.
- Expose a minimal preload API.
- Add a strict Content Security Policy.
- Prefer a custom protocol over broad `file://` renderer access.
- Restrict pet asset loading to the selected pet directory or bundled sample assets.
- Treat event messages as plain text only.

## 16. Performance, battery, and resource usage

**Level:** High
**Likelihood:** Medium-High

A constantly animated always-on-top Electron window can waste CPU/GPU, drain battery, or annoy laptop users.

### What could go wrong

- Idle pet animation uses too much CPU/GPU.
- Animation continues while hidden or sleeping.
- Speech/status updates cause unnecessary re-renders.
- Users reject the app because Electron feels heavy for a pet overlay.

### Possible plan/spec changes

- Add reduced-motion mode earlier.
- Pause animations in sleep/hidden states.
- Disable speech bubbles by default.
- Consider Tauri later if Electron usage is a real adoption blocker.

### Mitigation

- Profile idle CPU/GPU usage on all platforms.
- Keep one small window.
- Use CSS sprites, not polling/canvas loops.
- Pause animation when hidden/sleeping.
- Support reduced-motion behavior.
- Cap speech/status update frequency.

## 17. Ambitious phase-1 scope compression

**Level:** Critical
**Likelihood:** High

Phase 1 intentionally includes cross-platform desktop, CLI, HTTP API, pet rendering, Claude Code, OpenCode, and packaging/validation. This is possible with parallel agents, but schedule pressure can still force bad decisions.

### What could go wrong

- Integrations are polished before the overlay is stable.
- Cross-platform validation is delayed until too late.
- Half-finished features create a confusing launch.
- Teams add deferred systems to solve phase 1 problems.

### Possible plan/spec changes

- Define “rough but acceptable” platform support for launch.
- Reorder milestones without cutting required scope.
- Label specific platform limitations explicitly.

### Mitigation

- Keep the required phase 1 scope, but gate by vertical milestones.
- Do not polish integrations before cross-platform manual demo works.
- Define launch acceptance criteria before implementation.
- Avoid adding MCP, WebSocket, SDKs, cloud sync, or new pet formats to compensate for schedule pressure.

## 18. Dependency/version pinning drift

**Level:** Medium
**Likelihood:** High

Electron, Bun, Claude Code, OpenCode, and their related APIs can move during implementation.

### What could go wrong

- A Bun/Electron version upgrade breaks build scripts.
- Claude Code hook payloads differ from fixture assumptions.
- OpenCode plugin event names or payloads change.
- Generated integration snippets become stale.

### Possible plan/spec changes

- Add versioned adapter templates.
- Pin dependencies more aggressively.
- Record tested host tool versions per release.

### Mitigation

- Pin known-good versions in package manifests and docs.
- Add fixture payloads for Claude Code and OpenCode.
- Record tested Claude Code/OpenCode versions in release notes.
- Avoid relying on undocumented payload fields when possible.

## Top risks to validate first

Before deep integration work, validate these in order:

0. Contract freeze: event schema, reducer rules, pet pack contract, CLI lifecycle, and package boundaries.
1. Secure real platform test environments for macOS, Linux, and Windows.
2. Electron transparent always-on-top small window on macOS, Linux, and Windows.
3. `openpets start` launches app and `/health` works reliably.
4. `openpets event <state>` updates renderer through local HTTP + IPC.
5. Codex/Petdex sample pet renders correctly with CSS sprites.
6. State reducer prevents flicker under rapid event spam.
7. Claude/OpenCode bridges no-op silently when OpenPets is unavailable.

## Risk-driven implementation rule

If any risk forces a change, prefer changes that preserve the core contract:

```txt
tool/agent/script → OpenPets event → local server → state reducer → pet renderer
```

Avoid solving risks by adding large new systems such as MCP, WebSocket, cloud sync, databases, or a separate daemon in phase 1.
