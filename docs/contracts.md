# OpenPets Contracts

## Architecture

OpenPets uses MCP for agent-authored updates and same-user OS IPC for local desktop communication.

```txt
Claude / OpenCode / future agents
        ↓ MCP stdio
@open-pets/mcp
        ↓ @open-pets/client
Unix socket / Windows named pipe
        ↓
OpenPets desktop main process
        ↓ Electron IPC
renderer pet overlay
```

There is no localhost HTTP integration API, no fixed integration port, and no compatibility shim for old hook/integrate commands.

The renderer development server may still use `127.0.0.1:5173`; that is not an integration transport.

## IPC endpoint

Unix default:

```txt
$XDG_RUNTIME_DIR/openpets/openpets.sock
```

Unix fallback:

```txt
/tmp/openpets-$UID/openpets.sock
```

Windows:

```txt
\\.\pipe\openpets-<best-effort-user-session-suffix>
```

The trust model is same-user local IPC. This is not a universal permission boundary against every local process.

## IPC framing

- Newline-delimited JSON over `net.Socket` / named pipe.
- One JSON request line per connection.
- One JSON response line per connection.
- Server closes connection after response.
- Max frame size: `16 KiB`.
- Default request timeout: `1000ms`.
- Safe send timeout: `400ms`.
- `id` is a non-empty string up to 80 chars.

Request:

```ts
type IpcRequest = {
  id: string;
  method: "health" | "event" | "window";
  params?: unknown;
};
```

Response:

```ts
type IpcResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: { code: string; message: string } };
```

Error codes:

```txt
invalid-json
invalid-request
unknown-method
invalid-params
payload-too-large
timeout
internal-error
```

## IPC methods

### `health`

Response result:

```ts
type OpenPetsHealthV2 = {
  app: "openpets";
  ok: true;
  version: string;
  protocolVersion: 2;
  transport: "ipc";
  capabilities: Array<"event-v2" | "window-v1" | "speech-v1">;
  ready: boolean;
  activePet: string | null;
  debug?: boolean;
  window?: unknown;
};
```

`ready: false` means the desktop process is alive but the renderer/pet is not usable yet.

### `event`

Params are a validated `OpenPetsEvent`.

Response result:

```json
{ "state": "thinking" }
```

### `window`

Params:

```ts
{ action: "show" | "hide" | "sleep" | "quit" }
```

Response result:

```json
{ "action": "show" }
```

## `@open-pets/client`

`@open-pets/client` is IPC-only.

```ts
type OpenPetsClientOptions = {
  endpoint?: string;
  timeoutMs?: number;
  verifyOpenPets?: boolean;
};
```

Environment:

```txt
OPENPETS_IPC_ENDPOINT
```

## `@open-pets/mcp`

MCP runs over stdio. Stdout is MCP protocol only; diagnostics go to stderr.

Tools:

- `openpets_health`: concise desktop reachability.
- `openpets_start`: launches the local built desktop app when it is not running. This is for local monorepo/dev installs and waits until IPC health reports ready.
- `openpets_set_state`: status-only pet event from source `mcp`.
- `openpets_say`: short validated authored speech from source `mcp`.

`openpets_say` is max 100 chars, one line, no markdown, URLs, paths, commands, secrets, logs, exact errors, or stack traces. It is rate-limited and deduped.

Renderer speech is transient: about 4s normally, about 5s for success/error. State remains after the message disappears.

## CLI

The CLI uses `@open-pets/client` over IPC.

```txt
openpets start [--pet ./examples/pets/slayer] [--scale 1] [--debug]
openpets event <state> [--source cli] [--message text] [--tool tool] [--type type]
openpets show|hide|sleep|quit
```

Agent integration should prefer MCP via `openpets-mcp` / `@open-pets/mcp`.
