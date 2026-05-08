# Pi agents + OpenPets

For Pi agents, use the Pi extension package:

https://github.com/ninehills/pi-openpets.git

The extension uses Pi hooks to mirror agent lifecycle and tool activity to the local OpenPets desktop pet. It does not depend on MCP, does not require MCP configuration, and does not expose OpenPets as an LLM tool.

It does not send prompts, tool arguments, tool output, model output, file contents, command output, secrets, or private data to OpenPets.

## 1. Install OpenPets desktop

Download and launch OpenPets from the official releases page:

https://github.com/alvinunreal/openpets/releases/latest

OpenPets must be running before the extension can connect to the local IPC endpoint. If OpenPets is not running, the extension shows a warning in Pi and continues without blocking the agent.

## 2. Install the Pi extension

Install directly from GitHub. The integration runs through Pi hooks, so there is no `mcpServers` entry to add:

```bash
pi install git:github.com/ninehills/pi-openpets.git
```

Then restart Pi, or run `/reload` in Pi.

For project-local installation:

```bash
pi install -l git:github.com/ninehills/pi-openpets.git
```

## 3. Use OpenPets commands in Pi

After loading the extension, Pi provides these commands:

```text
/openpets install <zip-url|local-zip|pet-folder>
/openpets show
/openpets hide
/openpets status
/openpets test
```

- `/openpets install <zip-url|local-zip|pet-folder>` installs a Codex/Petdex pet and activates it when the running OpenPets app supports live pet selection.
- `/openpets show` shows the OpenPets window.
- `/openpets hide` hides the OpenPets window.
- `/openpets status` checks the local OpenPets connection.
- `/openpets test` sends a waving test event.

## What it shows

The hook integration sends short status messages, such as connection status, thinking, tool use, tool completion, response lifecycle, completion, and shutdown. These messages are intentionally generic so OpenPets can reflect agent progress without receiving sensitive session data.
