# Changelog

All notable changes to OpenPets will be documented in this file.

## 0.1.3 - 2026-05-06

- Disable Chromium macOS Safe Storage keychain initialization to avoid an unnecessary Keychain permission prompt.
- Simplify the desktop tray pet picker by moving Default into Select Pet and showing pet display names only.
- Allow `install-pet` catalogs to use `https://zip.openpets.dev/pets/*.zip` R2 download URLs.

## 0.1.2 - 2026-05-06

- Add Intel Mac (`x64`) desktop release artifacts alongside Apple Silicon (`arm64`) macOS builds.
- Add `install-pet` one-command pet installer package and shared pet installer package.

## 0.1.0 - 2026-05-06

- Initial desktop preview release; macOS is the known-good baseline, with Windows/Linux preview artifacts after native-host smoke testing.
- Add Electron desktop pet with tray/menu-bar controls.
- Add secure same-user IPC transport.
- Add Claude MCP tools for health, start, state, speech, and release.
- Add lifecycle leases for safe shared agent ownership.
- Add TypeScript client, local CLI, and Codex/Petdex pet loader.
