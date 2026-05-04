# OpenPets v0.1 Preview Launch Readiness Plan

Status: reviewed draft  
Scope: `openpets/` desktop app, core packages, MCP server, CLI, docs, and release path.

## Launch thesis

OpenPets v0.1 should be a **desktop preview launch** with macOS arm64 as the known-good baseline and Windows/Linux preview artifacts built on native hosts when available.

The goal is to let early users install the desktop pet from a GitHub release, run it from the menu bar/tray, and connect Claude Code reliably enough for daily local use.

Non-goals for v0.1 preview:

- polished Windows/Linux installers
- auto-update
- public production-grade CLI package
- Petdex web app launch
- perfect app-store-grade onboarding

If the goal changes to a full production launch, code signing/notarization, npm publishing, and cross-platform release automation become P0 instead of P1.

## Current state

Implemented locally:

- Electron desktop app builds from source and packages for macOS arm64 locally.
- Desktop runs as a tray/menu-bar app and hides the macOS Dock icon.
- Secure same-user IPC exists.
- Lifecycle leases support shared agent ownership and `openpets_release`.
- `@openpets/client` and `@openpets/mcp` build to `dist` and are versioned for `0.1.0`.
- Claude Code can connect to the MCP server from a built checkout.
- Tests/typechecks/build pass locally.

Still launch-sensitive:

- Windows/Linux artifacts require native-host packaging and smoke tests.
- The CLI remains source/Bun/dev-only and intentionally private.
- MCP npm publishing still needs tarball/install smoke testing before tag.
- App signing/notarization is deferred for preview.

## Canonical v0.1 user flow

Pick this as the initial launch contract:

1. User downloads an OpenPets desktop artifact for their platform.
2. User opens OpenPets; it appears in the menu bar/tray.
3. User configures Claude Code with the OpenPets MCP server.
4. Claude can call:
   - `openpets_health`
   - `openpets_start`
   - `openpets_set_state`
   - `openpets_say`
   - `openpets_release`

Canonical MCP install path for v0.1: publish `@openpets/mcp@0.1.0` and document `bunx @openpets/mcp` / Claude Code setup. The desktop app is a prerequisite; MCP is not bundled into the desktop app in v0.1.

## P0 preview blockers

These must be fixed before a credible v0.1 preview.

### 1. Add repo/legal hygiene

Required:

- add root `LICENSE`
- add `CHANGELOG.md`
- add `.env*` to `.gitignore`
- document preview status clearly in `README.md`

Rationale: no public release without license and basic release notes.

### 2. Decide and set versions

Required:

- set OpenPets packages to `0.1.0`
- decide which packages are publishable vs internal
- avoid publishing packages with unresolved `workspace:*` dependencies

Packages needing decisions:

- `@openpets/core`
- `@openpets/client`
- `@openpets/mcp`
- `@openpets/cli`
- `@openpets/pet-format-codex`
- `@openpets/desktop` app package

Recommendation for v0.1:

- publish only what Claude setup needs, likely `@openpets/mcp` plus its required package dependencies
- keep `@openpets/cli` developer-only unless its launcher is fixed

### 3. Package the desktop app

Required:

- add Electron packaging tool (`electron-builder` or Electron Forge)
- output macOS arm64 artifact first (`.dmg` and `.zip`)
- add Windows/Linux targets as preview artifacts, built on native hosts:
  - Windows host/VM: NSIS installer and/or portable `.exe`
  - Linux host/VM/container: AppImage and optionally `.deb`
- configure app name and app id
- configure app icon from `images/icon.png` converted to `.icns`
- configure platform icons:
  - macOS `.icns`
  - Windows `.ico`
  - Linux `.png`
- include resources with explicit packaging config:
  - `apps/desktop/dist/main.js`
  - `apps/desktop/dist/preload.cjs`
  - `apps/desktop/dist/renderer/**`
  - `examples/pets/slayer/**`
  - `assets/tray-icon.png`

The current code expects production resources under `process.resourcesPath`, so packaging config must match or the code must be adjusted.

### 4. Fix packaged resource paths

Required smoke checks:

- packaged app loads default pet without repo checkout
- tray icon is not empty
- renderer loads from packaged files
- config file open/reveal works

Relevant current assumptions:

- default pet path falls back to `process.resourcesPath/pets/slayer`
- tray icon packaged candidate is `process.resourcesPath/assets/tray-icon.png`

### 5. Replace MCP dev-only desktop launcher

Current issue:

- `packages/mcp/src/launcher.ts` launches `bunx electron ../../../apps/desktop/dist/main.js`.

Required:

- production launcher should discover/open installed OpenPets app
- platform launcher order:
  - env override `OPENPETS_DESKTOP_COMMAND`
  - env app/path override `OPENPETS_DESKTOP_APP`
  - macOS: `open -a OpenPets`
  - Windows: installed exe lookup under `%LOCALAPPDATA%\Programs\OpenPets` and `%ProgramFiles%\OpenPets`
  - Linux: `openpets` on PATH, `/opt/OpenPets/openpets`, or documented AppImage override
  - monorepo dev fallback: `bunx electron apps/desktop/dist/main.js`
- keep dev fallback for monorepo development
- add env override, e.g. `OPENPETS_DESKTOP_COMMAND` or `OPENPETS_DESKTOP_APP`
- return helpful MCP error if desktop is not installed

This is P0 if Claude Code setup is part of v0.1.

### 6. Define MCP distribution path

If publishing `@openpets/mcp`:

- set version to `0.1.0`
- replace/resolve `workspace:*` dependencies
- ensure `bin.openpets-mcp` points to built `dist/index.js`
- ensure `files` includes `dist`
- add `prepublishOnly` or release build checklist
- test install from packed tarball (`npm pack` equivalent)

Before tag, test install from packed tarballs or registry preview. Do not rely on workspace linking for the documented Claude path.

### 7. Add install and smoke-test docs

Required docs:

- `INSTALL.md`
- Claude Code setup
- troubleshooting:
  - macOS Gatekeeper warning if unsigned
  - MCP connected but desktop not launching
  - reset config
  - tray icon/menu missing
  - IPC stale socket

Required smoke test checklist:

1. Install/open packaged app.
2. Confirm menu-bar/tray icon appears.
3. Confirm default pet appears.
4. Confirm IPC health works.
5. Configure Claude MCP.
6. Run `openpets_health`.
7. Run `openpets_start` when app is not running and when already running.
8. Run `openpets_say` and see pet state/speech update.
9. Run `openpets_release`.
10. Quit/relaunch and verify config persists.

## P1 production blockers

These are required for a broader production launch.

### 1. Code signing and notarization

For macOS production quality:

- Developer ID signing
- notarization
- hardened runtime as needed

If v0.1 is unsigned, `README.md` and `INSTALL.md` must explicitly explain Gatekeeper warnings.

### 2. Public npm package quality

For every published package:

- version `0.1.0` or later
- no unresolved `workspace:*`
- `files` allowlist
- built `dist` entrypoints
- correct `exports`
- package smoke test from tarball

Hidden package blocker:

- `@openpets/pet-format-codex` must either become publishable or remain fully internal/bundled. It cannot be a hidden source-only dependency of a public package.

### 3. Release automation

Deferred for now per maintainer preference; local packaging is the current release path.

Later automation should include:

- test
- typecheck
- build packages
- package macOS app
- upload release artifacts

### 4. Cross-platform desktop distribution

Preview artifacts:

- macOS `.dmg`/`.zip`
- Windows NSIS installer or portable `.exe`
- Linux AppImage and/or `.deb`

Required cross-platform checks:

- packaged resources load on each platform
- tray/menu behavior works on each platform
- MCP launcher can open installed app or reports helpful setup guidance
- IPC endpoint behaves correctly on Unix sockets and Windows named pipes

Builder host assumptions:

- macOS artifacts are built on macOS.
- Windows artifacts are built on Windows or a configured Windows VM; cross-building from macOS is not the launch baseline.
- Linux artifacts are built on Linux or a Linux container/VM; cross-building from macOS is not the launch baseline.

Linux tray caveat:

- Electron Tray support varies by desktop environment. Ubuntu GNOME may require AppIndicator support or extensions. Linux tray behavior is preview-quality until smoke-tested on common DEs.

Platform signing status:

- macOS unsigned preview is acceptable with clear Gatekeeper docs
- Windows unsigned preview must document SmartScreen warnings
- Linux artifacts should document executable permission/AppImage caveats

### 5. Security/release docs

Add:

- `SECURITY.md`
- dependency audit process
- release checklist
- known limitations

## CLI decision

`@openpets/cli` is not v0.1 user-facing unless fixed.

Current blockers:

- `bin` points to `src/index.ts`
- no build script
- uses Bun runtime directly
- launcher requires `bunx electron` and monorepo desktop dist

Recommendation:

- Mark CLI as developer-only in v0.1 docs.
- Do not publish it as a production npm CLI until it can locate the installed app or intentionally act only as an IPC client.

## Petdex decision

`petdex/` is a separate web product with its own cloud/database/env requirements.

For OpenPets v0.1:

- do not include Petdex in desktop launch scope
- consider moving Petdex to separate repo later
- ensure docs do not imply Petdex is required for OpenPets desktop

## Security and privacy checklist

Already good:

- no fixed localhost HTTP API
- same-user IPC with private socket directory and socket permissions
- Electron context isolation and sandbox
- restrictive CSP
- MCP speech safety validation
- no cloud dependency for desktop app

Before v0.1:

- add `.env*` to `.gitignore`
- document local-only behavior
- document config storage path
- dependency audit before release

Before production:

- `SECURITY.md`
- signing/notarization
- update strategy

## v0.1 execution checklist

1. Decide launch contract:
   - macOS arm64 only or universal macOS?
   - unsigned preview or signed/notarized?
   - MCP via npm or bundled/local path?
2. Add root hygiene:
   - `LICENSE`
   - `CHANGELOG.md`
   - `.env*` in `.gitignore`
3. Set package versions to `0.1.0`.
4. Add desktop packaging config.
5. Include default pet and tray/app icons in packaged resources.
6. Verify production resource paths.
7. Replace MCP launcher with packaged-app discovery plus dev fallback.
8. Make MCP distribution path work and document it.
9. Add `INSTALL.md` and update `README.md` quick start.
10. Package locally/native-host for macOS, Windows, and Linux.
11. Smoke test on clean platform users/machines.
12. Tag `v0.1.0` and upload release artifacts.

## Known limitations to publish with v0.1

- desktop preview; macOS first-class, Windows/Linux preview quality
- unsigned if signing is not completed
- CLI is developer-only unless explicitly fixed
- no auto-update
- Windows/Linux packages may be less polished than macOS initially
- pet packs use local Codex/Petdex directory format; zip import is not supported yet
