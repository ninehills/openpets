# Install OpenPets

OpenPets `0.1.0` is a desktop preview. macOS is the known-good baseline; Windows and Linux artifacts are preview-quality until smoke-tested on native hosts.

## macOS preview install

1. Download the latest OpenPets macOS artifact from GitHub Releases.
2. Open the downloaded `.dmg` or `.zip`.
3. Move `OpenPets.app` to `/Applications`.
4. Launch `OpenPets.app`.
5. Confirm the OpenPets icon appears in the macOS menu bar and the pet appears on your desktop.

### Unsigned preview warning

Early preview builds may be unsigned. If macOS blocks the app:

1. Open **System Settings → Privacy & Security**.
2. Find the OpenPets warning.
3. Choose **Open Anyway**.

Only install OpenPets builds from the official repository or a source you trust.

## Windows preview install

1. Download the Windows artifact from GitHub Releases.
2. Run the NSIS installer or portable `.exe`.
3. Launch OpenPets from the Start Menu or the executable.
4. Confirm the tray icon appears and the pet appears on your desktop.

Early preview builds may be unsigned. Windows SmartScreen may warn before opening the app.

## Linux preview install

1. Download the Linux AppImage or `.deb` artifact from GitHub Releases.
2. For AppImage, mark it executable if needed:

```bash
chmod +x OpenPets-*.AppImage
./OpenPets-*.AppImage
```

3. For `.deb`, install with your package manager.
4. Confirm the tray icon appears and the pet appears on your desktop.

Linux tray support varies by desktop environment. GNOME may require AppIndicator/tray extension support.

## Claude Code setup

Install the MCP server after the desktop app is installed:

```bash
claude mcp add -s user openpets -- bunx @openpets/mcp
```

Then restart Claude Code and ask Claude to use:

- `openpets_health`
- `openpets_start`
- `openpets_say`
- `openpets_set_state`
- `openpets_release`

If `@openpets/mcp` has not been published yet, use a built local checkout:

```bash
git clone https://github.com/alvinunreal/openpets.git
cd openpets
bun install
bun run build
claude mcp add -s user openpets -- bun /path/to/openpets/packages/mcp/dist/index.js
```

## OpenCode status

OpenCode integration is planned for the v0.1 ecosystem, but the desktop preview does not require it.

## Troubleshooting

### The tray/menu-bar icon is missing

- Quit and reopen OpenPets.
- Check Activity Monitor for duplicate OpenPets processes.
- Reinstall the latest release artifact.

### Claude says MCP is connected but the pet does not launch

- Launch OpenPets manually once.
- Run `openpets_health` again.
- If needed, set an override:

```bash
OPENPETS_DESKTOP_COMMAND="open -a OpenPets"
```

Examples:

```bash
# macOS
OPENPETS_DESKTOP_COMMAND="open -a OpenPets"

# Windows PowerShell
$env:OPENPETS_DESKTOP_APP="$env:LOCALAPPDATA\Programs\OpenPets\OpenPets.exe"

# Linux AppImage
OPENPETS_DESKTOP_APP="$HOME/Applications/OpenPets.AppImage"
```

### Reset OpenPets config

OpenPets stores local config at:

```txt
# macOS
~/Library/Application Support/OpenPets/config.json

# Windows
%APPDATA%\OpenPets\config.json

# Linux
$XDG_CONFIG_HOME/openpets/config.json or ~/.config/openpets/config.json
```

Use the tray menu: **Settings → Reveal Config Folder**, then quit OpenPets and remove `config.json`.

### IPC/socket seems stale

Quit OpenPets from the tray menu and relaunch. OpenPets cleans stale same-user IPC sockets on launch.

### The pet does not appear

- Use the tray menu item **Show Pet**.
- Use **Use Default Pet** from the tray menu.
- Quit and relaunch OpenPets.
