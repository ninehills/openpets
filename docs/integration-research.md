# OpenPets Integration Research

This document captures the pre-coding research for supporting Claude Code, OpenCode, and Codex-style pets in OpenPets.

## Product assumption

OpenPets is a local desktop pet overlay for AI coding agents, controlled by local events.

The integration contract should be simple:

```txt
developer tool / AI agent / script
        ↓
OpenPets event API
        ↓
local event server
        ↓
floating pet overlay
```

OpenPets should not be permanently tied to one agent, but phase 1 must focus on Claude Code, OpenCode, shell/test-runner events, Codex/Petdex pet compatibility, and macOS/Linux/Windows support.

## Canonical OpenPets event model

Use a small set of universal pet states first:

```txt
idle
thinking
working
editing
running
testing
waiting
waving
success
error
warning
celebrating
sleeping
```

Event payload shape:

```json
{
  "type": "agent.thinking",
  "state": "thinking",
  "source": "claude-code",
  "message": "Reasoning...",
  "sessionId": "optional-session-id",
  "tool": "optional-tool-name",
  "cwd": "/optional/project/path",
  "timestamp": 1760000000000
}
```

Initial local API surfaces:

```bash
openpets event thinking
openpets event testing --message "Running tests"
openpets event error --source vitest --message "3 tests failed"
```

```http
POST http://127.0.0.1:4738/event
Content-Type: application/json
```

```json
{
  "type": "tests.passed",
  "state": "success",
  "source": "npm"
}
```

## Claude Code support

### Best integration approaches

Claude Code can be integrated through three practical channels:

1. **Hooks** for normal interactive use.
2. **Streaming JSON output** for wrapper/headless workflows.
3. **MCP** as an advanced bidirectional integration.

### Hooks

Claude Code supports lifecycle/tool hooks in settings files. Useful hook events include:

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`
- `Notification`
- `Stop`
- `StopFailure`
- subagent/task related events where available

Hooks can call OpenPets through the CLI or local HTTP API.

Example hook concept:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "openpets hook claude-code"
          }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "openpets event waiting --source claude-code"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "openpets event success --source claude-code"
          }
        ]
      }
    ]
  }
}
```

Better than one command per event: provide a hook bridge command that reads the hook JSON from stdin and maps it:

```bash
openpets hook claude-code
```

The bridge should parse:

- `hook_event_name`
- `tool_name`
- `tool_input`
- `session_id`
- `cwd`
- `transcript_path`

### Claude Code event mapping

| Claude Code signal | OpenPets state |
|---|---|
| `SessionStart` | `idle` or `waving` |
| `UserPromptSubmit` | `thinking` |
| `PreToolUse` `Edit` / `Write` | `editing` |
| `PreToolUse` `Bash` | `running` or `testing` if command looks like tests |
| `PostToolUse` success | `working`, short `success`, then previous/idle |
| `PostToolUseFailure` | `error` |
| `Notification` / permission prompt | `waiting` |
| Permission/attention request | `waving` |
| `Stop` | `success` / `celebrating` |
| `StopFailure` | `error` |

### Streaming JSON wrapper

For users who run Claude Code in headless/wrapper mode, OpenPets can parse stream output:

```bash
claude -p "..." \
  --output-format stream-json \
  --verbose \
  --include-partial-messages
```

Useful stream signals:

- `thinking_delta` → `thinking`
- `text_delta` → `working/responding`
- `content_block_start` with `tool_use` → tool-specific state
- `system` `api_retry` → `waiting` or `warning`
- `result` success/error → `success` or `error`

This is powerful but is mostly for wrapped/headless use, not the default interactive integration.

### MCP

OpenPets can later expose an MCP server:

```json
{
  "mcpServers": {
    "openpets": {
      "type": "stdio",
      "command": "openpets",
      "args": ["mcp-server"]
    }
  }
}
```

Possible MCP tools:

- `openpets_set_state`
- `openpets_get_status`
- `openpets_choose_pet`
- `openpets_react`

MCP is not required for v0. Use hooks first.

### Claude Code limitations / risks

- Hook schemas and available events can change across versions.
- Hook setup has some user friction.
- Streaming JSON requires running Claude through a wrapper/headless mode.
- MCP is heavier and should be a later enhancement.

## OpenCode support

### Best integration approaches

OpenCode has a strong integration story. Recommended order:

1. **OpenCode plugin** for first-class real-time state detection.
2. **OpenCode server/SSE API** as a no-plugin observer mode.
3. **MCP** for bidirectional interactions later.

### Plugin API

OpenCode plugins can live in:

- project: `.opencode/plugins/`
- global: `~/.config/opencode/plugins/`

Plugin skeleton:

```ts
import type { Plugin } from "@opencode-ai/plugin"

export const OpenPetsPlugin: Plugin = async ({ client, project, directory, worktree }) => {
  return {
    event: async ({ event }) => {
      // inspect event.type and send to OpenPets
    },

    "tool.execute.before": async (input, output) => {
      // tool started
    },

    "tool.execute.after": async (input, output) => {
      // tool finished
    }
  }
}
```

Important OpenCode events/signals:

- `session.status`
- `session.idle`
- `session.error`
- `session.diff`
- `message.updated`
- `message.part.updated`
- `tool.execute.before`
- `tool.execute.after`
- `file.edited`
- `permission.asked`
- `permission.replied`
- `command.executed`

Important message part types:

- `reasoning` → thinking
- `tool` → tool execution
- `patch` → editing/code changes
- `subtask` → subagent/delegation
- `retry` → warning/waiting
- `step-start` / `step-finish` → workflow progress

### OpenCode event mapping

| OpenCode signal | OpenPets state |
|---|---|
| `session.status` busy | `thinking` or `working` |
| `session.status` idle | `idle` |
| `message.part.updated` reasoning | `thinking` |
| `message.part.updated` tool running | `working` |
| `tool.execute.before` Bash | `running` or `testing` |
| `tool.execute.before` edit/write/patch tools | `editing` |
| `tool.execute.after` completed | `success` briefly |
| `tool.execute.after` error | `error` |
| `file.edited` | `editing` |
| `permission.asked` | `waving` or `waiting` |
| `session.error` | `error` |

Minimum required OpenCode signals for phase 1:

```txt
session.status
tool.execute.before
tool.execute.after
```

Optional useful signals:

```txt
message.part.updated
file.edited
permission.asked
session.error
```

Keep this mapping in one small adapter/table so switching event names or payload handling is easy if OpenCode changes.

### Plugin bridge concept

OpenPets should ship an install command:

```bash
openpets integrate opencode
```

It can create or print a plugin file like:

```ts
import type { Plugin } from "@opencode-ai/plugin"

const OPENPETS_URL = process.env.OPENPETS_URL ?? "http://127.0.0.1:4738"

async function send(event: unknown) {
  try {
    await fetch(`${OPENPETS_URL}/event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    })
  } catch {
    // OpenPets is optional; never break OpenCode.
  }
}

export const OpenPetsPlugin: Plugin = async () => ({
  event: async ({ event }) => {
    if (event.type === "session.status") {
      await send({
        type: event.properties.status.type === "busy" ? "agent.working" : "agent.idle",
        state: event.properties.status.type === "busy" ? "thinking" : "idle",
        source: "opencode",
      })
    }
  },
  "tool.execute.before": async (input) => {
    await send({ type: "tool.started", state: "working", source: "opencode", tool: input.tool })
  },
  "tool.execute.after": async (input, output) => {
    await send({
      type: output?.state?.status === "error" ? "tool.failed" : "tool.completed",
      state: output?.state?.status === "error" ? "error" : "success",
      source: "opencode",
      tool: input.tool,
    })
  },
})
```

### Server/SSE mode

OpenCode also exposes a server API with event stream support. Useful endpoint:

```txt
GET /global/event
```

This can be used by OpenPets as observer mode:

```bash
openpets watch opencode --server http://127.0.0.1:4096
```

Pros:

- no plugin file required if OpenCode server is running
- central event stream

Cons:

- needs server access/auth info
- less portable than installing a small plugin

### OpenCode limitations / risks

- Plugin API may evolve.
- Plugin should never throw or block OpenCode.
- High-frequency events need debouncing.
- Tool output shapes should be handled defensively.

## Codex support

### Pet compatibility

Codex/Petdex pet packs are simple and should be supported 1:1 by OpenPets v0.

Package:

```txt
pet.zip
├── pet.json
└── spritesheet.webp or spritesheet.png
```

`pet.json`:

```json
{
  "id": "boba",
  "displayName": "Boba",
  "description": "A tiny otter..."
}
```

Spritesheet:

- fixed 8 columns × 9 rows
- frame size: 192 × 208
- full size: 1536 × 1872

Rows:

| Row | Codex state | Frames | OpenPets default mapping |
|---:|---|---:|---|
| 0 | `idle` | 6 | `idle`, `sleeping` fallback |
| 1 | `running-right` | 8 | movement/right |
| 2 | `running-left` | 8 | movement/left |
| 3 | `waving` | 4 | `waiting`, greeting |
| 4 | `jumping` | 5 | `success`, `celebrating` |
| 5 | `failed` | 8 | `error` |
| 6 | `waiting` | 6 | `waiting`, `testing` fallback |
| 7 | `running` | 6 | `running`, `working`, `editing` |
| 8 | `review` | 6 | `thinking`, `reviewing` |

Recommended OpenPets mapping:

```txt
idle        → idle
thinking    → review
working     → running
editing     → running
running     → running
testing     → waiting
waiting     → waiting or waving
waving      → waving
success     → jumping
error       → failed
warning     → failed
celebrating → jumping
sleeping    → idle
```

### Codex app integration

Codex has its own pet feature in the desktop app, but OpenPets should not depend on controlling that internal overlay.

Recommended approach:

1. Use Codex/Petdex format as an import/render format.
2. Add Codex hooks bridge if/when stable hooks are available.
3. Optionally observe Codex session JSONL files as a fallback/experimental watcher.

### Codex limitations / risks

- The desktop pet overlay is not known to be externally controllable.
- CLI pet support appears limited or unavailable.
- Session file formats and hooks can change.
- OpenPets should render its own overlay rather than trying to drive Codex's overlay.

## Recommended phase 1 integration priority

Build in this order:

1. **Core OpenPets overlay + local event API**
    - `openpets start`
    - `openpets event <state>`
    - local HTTP endpoint `/event`
    - keep the event server hosted inside the desktop app initially if possible
    - validate overlay behavior on macOS, Linux, and Windows from the beginning

2. **Codex/Petdex pet format support**
    - load `pet.json`
    - load `spritesheet.webp/png`
    - render fixed grid states
    - use existing Codex rows for all phase 1 emotions/animations

3. **OpenCode plugin bridge**
    - strongest first-class integration
    - real-time events
    - easy state mapping
    - small metadata-only bridge; never break OpenCode if OpenPets is not running

4. **Claude Code hooks bridge**
    - CLI/hook command that reads JSON from stdin
    - user/project settings snippet installer
    - small metadata-only bridge; never break Claude Code if OpenPets is not running

5. **Defer observer modes**
    - `openpets watch opencode --server ...`
    - `openpets watch claude --stream ...`
    - experimental Codex session watcher

6. **Defer MCP server**
   - only after the phase 1 bridges work and users want bidirectional interactions

## Sources to keep handy

- Claude Code hooks/settings/MCP/headless docs
- OpenCode plugin docs
- OpenCode server API docs
- OpenCode SDK docs
- Codex hooks/config docs
- Petdex repo: `/home/alvin/openpets/petdex`
- Petdex format files:
  - `/home/alvin/openpets/petdex/src/lib/pet-states.ts`
  - `/home/alvin/openpets/petdex/src/components/pet-sprite.tsx`
  - `/home/alvin/openpets/petdex/src/app/globals.css`
