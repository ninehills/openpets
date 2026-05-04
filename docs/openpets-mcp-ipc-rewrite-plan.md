# OpenPets MCP + IPC Rewrite Plan

## Direction

Rewrite the agent-facing integration path around MCP over stdio and OS IPC. The old fixed-port local HTTP integration path is deleted, not retained as compatibility code.

Target architecture:

```txt
Claude / OpenCode / future agents
        ↓ MCP stdio
@openpets/mcp
        ↓ @openpets/client transport abstraction
Unix domain socket / Windows named pipe
        ↓
OpenPets desktop main process
        ↓ IPC
renderer pet overlay
```

No backwards compatibility is required for old integration commands or fixed localhost API behavior. If rewriting or deleting code makes the architecture cleaner, do it.

## Goals

- Give LLM agents a first-class tool for authored pet speech.
- Remove localhost TCP as the normal integration transport.
- Replace fixed-port local integration with local OS IPC:
  - macOS/Linux: Unix domain socket
  - Windows: named pipe
- Keep the OpenPets event model and desktop renderer behavior.
- Make `@openpets/client` transport-agnostic.
- Make `@openpets/mcp` the preferred agent integration surface.
- Keep Claude/OpenCode hook/plugin status mapping as optional secondary adapters, not the primary agent UX.

## Non-goals

- No cloud service.
- No remote network API.
- No browser-accessible local API.
- No compatibility shim for `openpets hook claude-code` or `openpets integrate ...`.
- No raw transcript display.
- No automatic LLM summarization from hook payloads.
- No MCP server embedded in the renderer.

## Why MCP + IPC

### MCP gives agent-authored updates

Hooks can report state but cannot safely author natural language progress messages. MCP lets the LLM intentionally call a typed tool:

```json
{
  "state": "working",
  "message": "I’m narrowing down the cause."
}
```

This is the right boundary for “the pet is the agent talking.”

### IPC avoids localhost concerns

The former fixed-port local API worked but had drawbacks:

- fixed port conflicts
- local TCP surface area
- browser-origin hardening required
- awkward product story for a purely local pet

OS IPC is more appropriate:

- no TCP port
- local app IPC semantics
- path/pipe names can be app-scoped
- fewer browser-origin concerns

Important: OS IPC is not a permission boundary against every local process. The intended trust model is **same-user local IPC only**. The implementation must avoid cross-user exposure and common filesystem race/symlink pitfalls.

## New package layout

```txt
openpets/
  packages/core
  packages/client
  packages/mcp
  packages/pet-format-codex
  packages/cli
  apps/desktop

claude-pets/
  optional Claude-specific installer/docs

opencode-pets/
  optional OpenCode-specific installer/docs
```

## Runtime roles

### `apps/desktop`

Owns:

- transparent pet overlay
- local IPC server
- event reducer/state publishing
- pet loading
- window actions

Desktop should no longer start a public HTTP server by default.

### `@openpets/client`

Owns:

- transport abstraction
- event normalization/validation
- IPC request/response protocol
- safe send behavior
- health/status checks

Primary transport should be IPC.

HTTP integration transport is deleted entirely. Do not retain a dev fallback or compatibility shim.

### `@openpets/mcp`

Owns:

- MCP stdio server
- tools:
  - `openpets_say`
  - `openpets_set_state`
  - `openpets_health`
- strict tool input validation
- safe speech policy

### `packages/cli`

Owns:

- start/show/hide/sleep/quit lifecycle commands
- manual `openpets event <state>` for shell demos
- `openpets mcp` convenience command, if we want CLI to launch the MCP package

The CLI should use `@openpets/client` over IPC.

## IPC transport design

### Transport names

Use a stable app-scoped endpoint.

macOS/Linux:

```txt
$XDG_RUNTIME_DIR/openpets/openpets.sock
```

Fallback if `XDG_RUNTIME_DIR` is unavailable:

```txt
/tmp/openpets-$UID/openpets.sock
```

Windows:

```txt
\\.\pipe\openpets-$USER_OR_SID
```

Use a per-user or per-session suffix. Plain `\\.\pipe\openpets` is too collision-prone across users/sessions.

### Socket permissions

On macOS/Linux:

- create parent directory with `0700`
- unlink stale socket before listen if no live server responds
- socket file should not be world-writable
- verify parent directory ownership before use
- reject symlinked parent/socket paths
- defend against `/tmp/openpets-$UID` pre-creation by another user

On Windows:

- use a per-user/per-session pipe name
- validate named-pipe access behavior during implementation
- add explicit ACL restrictions if Node/Electron APIs make that practical

### IPC framing

Use newline-delimited JSON over `net.Socket` / named pipe.

Framing rules:

- one JSON request line per connection
- one JSON response line per connection
- server closes connection after response
- maximum frame size: `16 KiB`
- request timeout: `1000ms` default, `400ms` for safe/non-blocking sends
- `id` must be a non-empty string <= 80 chars
- invalid JSON returns an error response if possible, then closes
- params are strictly validated per method

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

One request per connection is acceptable for simplicity. Persistent connections can come later if needed.

Common error codes:

```txt
invalid-json
invalid-request
unknown-method
invalid-params
payload-too-large
timeout
internal-error
```

### IPC methods

#### `health`

Response:

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

Example:

```json
{
  "app": "openpets",
  "ok": true,
  "version": "0.0.0",
  "protocolVersion": 2,
  "transport": "ipc",
  "capabilities": ["event-v2", "window-v1", "speech-v1"],
  "ready": true,
  "activePet": "slayer"
}
```

Use `protocolVersion: 2` for the IPC protocol to distinguish it from the existing HTTP v1.

#### `event`

Params:

```ts
OpenPetsEvent
```

Response:

```json
{ "state": "thinking" }
```

#### `window`

Params:

```ts
{ "action": "show" | "hide" | "sleep" | "quit" }
```

Response:

```json
{ "action": "show" }
```

This replaces Electron second-instance action handoff for non-start lifecycle commands if cleaner. Keeping second-instance only for `start`/single-instance app activation is acceptable.

### Startup/readiness ordering

Desktop should start the IPC server early in the main process, before renderer readiness. Return `ready: false` until the renderer/pet state is usable. This lets CLI/MCP distinguish:

- desktop not running
- desktop booting
- desktop ready

## `@openpets/client` rewrite

### Public API

Keep caller-facing API mostly stable but transport-agnostic:

```ts
type OpenPetsClientOptions = {
  endpoint?: string;
  timeoutMs?: number;
};

createOpenPetsClient(options?: OpenPetsClientOptions): OpenPetsClient;
getHealth(options?: OpenPetsClientOptions): Promise<OpenPetsHealth>;
sendEvent(event: OpenPetsEventInput, options?: OpenPetsClientOptions): Promise<{ ok: true; state: OpenPetsState }>;
safeSendEvent(event: OpenPetsEventInput, options?: OpenPetsClientOptions): Promise<OpenPetsSafeResult>;
windowAction(action: OpenPetsWindowAction, options?: OpenPetsClientOptions): Promise<{ ok: true; action: OpenPetsWindowAction }>;
```

Default transport:

```txt
ipc
```

HTTP transport is not supported.

### Environment variables

Prefer:

```txt
OPENPETS_IPC_ENDPOINT
```

Do not keep `OPENPETS_BASE_URL` or any HTTP URL environment variable.

## `@openpets/mcp` design

### Package files

```txt
packages/mcp/
  package.json
  tsconfig.json
  src/
    index.ts
    server.ts
    tools.ts
    safety.ts
  src/safety.test.ts
  src/tools.test.ts
```

### MCP transport

Use stdio.

Stdout is MCP protocol only. Never write logs or diagnostics to stdout. All diagnostics must go to stderr and only when appropriate.

Command target examples:

```bash
bun /home/alvin/openpets/packages/mcp/src/index.ts
```

Later publish/bin:

```bash
openpets mcp
# or
openpets-mcp
```

The dev Bun/source path is only for local development. Packaged installs should use `openpets mcp` or a published `openpets-mcp` binary so end users do not need Bun or source paths.

### Tool: `openpets_say`

Purpose: LLM-authored pet speech with a required display state.

Schema:

```ts
{
  state: "thinking" | "working" | "editing" | "running" | "testing" | "waiting" | "success" | "error";
  message: string;
}
```

Tool description:

```txt
Send a short safe progress update to the OpenPets desktop pet. Use occasionally during work when a brief status would help the user feel progress. Do not include user text, code, file paths, shell commands, command output, logs, diffs, URLs, secrets, tokens, exact error messages, or private data. Keep it under 100 characters and one sentence.
```

Implementation:

- validate state
- validate message safety
- enforce rate limiting/deduping
- send event:

```ts
{
  state,
  source: "mcp",
  type: "mcp.say",
  message
}
```

### Tool: `openpets_set_state`

Purpose: status-only update.

Schema:

```ts
{ state: OpenPetsState }
```

Implementation:

```ts
{
  state,
  source: "mcp",
  type: `mcp.state.${state}`
}
```

### Tool: `openpets_health`

Purpose: check whether desktop is reachable.

Schema:

```ts
{}
```

Response should be concise:

```json
{ "running": true, "activePet": "slayer" }
```

## Speech safety policy

Default policy should reject messages that violate these rules:

- max 100 characters
- Unicode normalize before validation
- one line only
- no control characters or ANSI escape codes
- no markdown/code fences
- no URLs
- no absolute/relative file paths
- no Windows paths
- no shell commands
- no obvious secrets/tokens
- no long hex/base64-looking strings
- no exact stack traces or log-looking text
- fail closed: rejected messages are not sent to desktop

Add unit tests for accepted and rejected examples. MCP tool descriptions guide the LLM, but code validation is mandatory.

Allowed examples:

```txt
I’m mapping the moving parts.
I found the likely path.
Running a quick check.
I hit a snag and I’m checking why.
That worked.
```

Rejected examples:

```txt
I’m editing src/auth/session.ts.
Running npm test -- --token abc123.
Error: Cannot read properties of undefined.
Here is the diff: ...
Check https://...
```

## Desktop renderer behavior for speech

Speech bubbles should feel transient.

Change renderer behavior if needed:

- message bubble auto-hides after ~4 seconds
- new message replaces old message
- state can remain long-running after message disappears
- success/error messages may stay slightly longer, e.g. 5 seconds

This may require separating `event.message` display lifetime from reducer state lifetime.

This is mandatory for MCP speech. Current event messages can remain visible indefinitely with long-running states; that must be changed before enabling `openpets_say` broadly.

## Claude integration path

Preferred Claude setup should become MCP, not hooks.

Potential `claude-pets` role after MCP:

- install MCP config
- optionally install hooks for automatic state transitions
- provide Claude-specific instructions for when to call `openpets_say`

Example install command later:

```bash
claude-pets install --mcp
```

It should configure Claude to run:

```json
{
  "mcpServers": {
    "openpets": {
      "type": "stdio",
      "command": "bun",
      "args": ["/home/alvin/openpets/packages/mcp/src/index.ts"]
    }
  }
}
```

This source-path config is dev-only. Published/package setup must use a stable command, e.g. `openpets mcp`.

Also add an instruction such as:

```txt
Use the OpenPets MCP tool occasionally for short, safe progress updates while working. Prefer general progress language. Never include user text, code, paths, commands, logs, diffs, secrets, URLs, or exact errors.
```

## OpenCode integration path

If OpenCode supports MCP tools cleanly, prefer MCP for authored speech.

`opencode-pets` can remain useful for:

- installing OpenCode MCP config/instructions
- optional plugin-based automatic status transitions

## Rewrite/deletion policy

No backwards compatibility required. During implementation:

- delete HTTP server code from desktop if IPC fully replaces it
- delete HTTP default from `@openpets/client`
- update docs/contracts to remove fixed port as primary contract
- rewrite tests around IPC protocol
- keep only intentional dev fallback code, clearly marked and not default
- remove stale examples that reference localhost as the main integration path

Do not accidentally remove renderer development server support (`127.0.0.1:5173`); that is separate from the integration transport.

## Implementation phases

### Phase 1: IPC helpers and protocol tests

- Add endpoint helper and trust/safety checks.
- Add frame parser/serializer.
- Add request dispatcher types and validation.
- Add `net.Server` protocol tests outside Electron.

### Phase 2: Desktop IPC server and client transport, switched atomically

- Add IPC path helper in core or client.
- Implement Unix socket/named pipe server in desktop main process.
- Add `health`, `event`, and `window` methods.
- Add IPC tests where possible using Node `net`.
- Add `IpcTransport`.
- Make IPC default.
- Update CLI to use IPC client.
- Update tests.

This phase lands atomically with the HTTP integration path deleted after IPC client + CLI are validated.

### Phase 3: Delete HTTP integration transport

- Prefer deleting desktop HTTP server entirely.
- HTTP must not be default in `@openpets/client`.
- Update docs/contracts to remove fixed port as primary contract.

### Phase 4: MCP package

- Add `@openpets/mcp`.
- Implement stdio MCP server.
- Implement `openpets_say`, `openpets_set_state`, `openpets_health`.
- Add safety tests.
- Add MCP smoke test if feasible.

### Phase 5: Integration repo updates

- Update `claude-pets` to install MCP config/instructions.
- Keep hook mapping optional for automatic state transitions if still useful.
- Update `opencode-pets` similarly if OpenCode MCP setup is supported.

### Phase 6: Docs cleanup

- Update contracts to define IPC protocol v2.
- Remove fixed localhost/port as required contract.
- Update quickstart to prefer MCP.
- Keep shell manual `openpets event` docs, but describe it as local IPC-backed CLI, not HTTP.

## Open questions

- HTTP deletion decision: delete immediately; do not keep a debug fallback.
- Should `openpets start` create the IPC endpoint before renderer loads, or only after renderer ready?
- Should `openpets mcp` live in `packages/cli` as a wrapper or only in `@openpets/mcp`?
- How exactly should Claude Code project MCP config be written and merged safely?
- Does OpenCode support MCP tools in the desired workflow, or only plugins?
- How strict should speech safety validation be by default?
