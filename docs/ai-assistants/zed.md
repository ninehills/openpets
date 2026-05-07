# Zed + OpenPets

Zed supports MCP context servers and project rules, which makes it a good fit for OpenPets.

## 1. Install OpenPets desktop

Download and launch OpenPets from https://github.com/alvinunreal/openpets/releases/latest.

## 2. Configure MCP

Open `~/.config/zed/settings.json` and add OpenPets under `context_servers`:

```json
{
  "context_servers": {
    "openpets": {
      "command": "bunx",
      "args": ["@open-pets/mcp"]
    }
  }
}
```

If you already have `context_servers`, merge the `openpets` entry into it.

Restart Zed after changing settings.

## 3. Add Zed rules

Create a project `.rules` file, or add this to your Zed rules library:

```md
Use OpenPets for safe, short progress updates while you work.

- At the start of a task, call `openpets_start` if OpenPets is not already running.
- Use `openpets_set_state` for silent status changes like `thinking`, `working`, `editing`, `testing`, `waiting`, `success`, or `error`.
- Use `openpets_say` occasionally for brief status bubbles. Keep messages under 100 characters.
- Never send user text, code, file paths, command output, logs, diffs, URLs, secrets, tokens, exact errors, or private data to `openpets_say`.
- Before your final response, set `success` when work completed or `error` when blocked.
```

## 4. Test

Open Zed Agent Panel and ask:

> Check OpenPets health, start it if needed, then tell my pet you are connected.

## Troubleshooting

- Make sure `bunx` is available in the environment Zed launches from.
- Make sure the OpenPets desktop app has been opened at least once.
- If Zed cannot find the server, try using the absolute path to `bunx`.
