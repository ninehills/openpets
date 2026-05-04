# OpenPets MCP + IPC Implementation Spec

## Purpose

This spec turns `docs/openpets-mcp-ipc-rewrite-plan.md` into an implementation sequence with explicit review gates. The target is to replace the agent-facing localhost HTTP integration path with MCP over stdio plus same-user OS IPC between packages and the desktop process.

## Current Baseline

- `apps/desktop/src/main.ts` starts an IPC server and no longer starts a localhost HTTP integration server.
- `@openpets/client` is IPC-only and resolves `OPENPETS_IPC_ENDPOINT` / the default per-user IPC endpoint.
- `packages/cli` uses `@openpets/client` over IPC for health, events, and window actions.
- `packages/core/src/ipc.ts` contains IPC protocol helpers and tests:
  - endpoint resolution
  - Unix parent directory safety checks
  - newline-delimited JSON framing
  - request validation
  - dispatcher/socket helpers
- `packages/mcp` exists and exposes MCP tools over stdio.

## Non-Negotiable Constraints

- Do not break renderer dev server usage on `127.0.0.1:5173`; it is unrelated to the integration transport.
- No legacy HTTP integration transport, compatibility shim, or dead fixed-port code should remain.
- MCP stdout must be protocol-only; diagnostics go to stderr.
- IPC is same-user local IPC, not a universal local-process permission boundary.
- Unix socket setup must avoid symlink/race-prone behavior as much as practical in Node/Electron.
- Speech messages from MCP must pass code-level safety validation; tool descriptions are not enough.

## Phase 1 — IPC Protocol Foundation

Status: implemented.

Deliverables:

- Shared IPC types and helpers in `@openpets/core`.
- Endpoint resolution for Unix sockets and Windows named pipes.
- Unix parent directory safety validation.
- NDJSON frame serialization/parsing with 16 KiB max frame size.
- Request validation for `health`, `event`, and `window`.
- Dispatcher and one-request-per-connection socket helper.
- Unit/protocol tests outside Electron.

Validation:

- `bun test packages/core/src/ipc.test.ts`
- `bun test packages/core/src`
- `bunx tsc -p packages/core/tsconfig.json --noEmit`

Review gate:

- Ask @oracle to review before Phase 2 work continues.

## Phase 1.5 — IPC Safety Hardening Before Desktop Adoption

Goal: harden the newly added IPC helpers before desktop startup depends on them.

Required fixes:

- In `ensureSafeIpcParentDirectory()`, reject symlinked parents before any operation that follows symlinks, including `chmod`.
- Reject endpoint paths that already exist and are not sockets.
- Never unlink an IPC endpoint unless `lstat(endpoint).isSocket()` and the path is not a symlink.
- Add a stale socket helper with explicit outcomes:
  - live OpenPets IPC server: do not listen; report already running / hand off as appropriate
  - connection refused / no listener on a socket path: unlink as stale
  - valid connection but invalid/non-OpenPets protocol: fail closed, do not unlink
  - regular file/directory/FIFO/symlink at endpoint: fail closed, do not unlink
- Add tests for:
  - symlink parent ordering
  - existing regular file endpoint
  - symlink endpoint
  - stale socket cleanup decision
  - invalid live service at endpoint is not unlinked

Windows decision before Phase 2:

- Do not claim strong named-pipe isolation until validated.
- First pass decision: Node/Electron does not provide a simple built-in SID/ACL API in the current codebase, so Phase 1.5 uses a best-effort collision-resistant suffix from available environment/user/session fields.
- Do not describe this as a strong Windows permission boundary.
- Prefer a stable SID/session-derived suffix if a practical dependency-free approach is found later.
- Track explicit ACL restriction as a follow-up if Node/Electron APIs do not make it straightforward.

Validation:

- `bun test packages/core/src/ipc.test.ts`
- `bunx tsc -p packages/core/tsconfig.json --noEmit`

Review gate:

- Ask @oracle to review Phase 1.5 before implementing Phase 2.

## Phase 2/3 — IPC-Only Desktop Server, Client Transport, CLI Switch, and HTTP Deletion

Goal: make the integration path IPC-only and delete the localhost HTTP integration transport entirely.

### Desktop server

Implement by extracting testable IPC startup/handler code instead of adding all logic directly to `apps/desktop/src/main.ts`.

Suggested shape:

```txt
apps/desktop/src/ipc-server.ts
apps/desktop/src/ipc-handlers.ts
```

The extracted code should expose pure/testable functions where possible, for example:

```ts
createDesktopIpcHandlers({ getHealth, applyEvent, handleWindowAction })
startDesktopIpcServer(endpoint, handlers)
```

Behavior:

- Start IPC server early in `app.whenReady()`, before renderer readiness is required.
- Use `getDefaultOpenPetsIpcEndpoint()` and `ensureSafeIpcParentDirectory()`.
- On Unix:
  - validate the parent directory before any endpoint cleanup
  - if endpoint exists, inspect with `lstat` first
  - never unlink non-socket paths
  - if socket exists, try a quick IPC health probe before unlinking
  - if health probe returns OpenPets health, treat another instance as live
  - if connection succeeds but protocol is invalid/non-OpenPets, fail closed and do not unlink
  - unlink stale socket only for clear stale cases such as `ECONNREFUSED` on an existing socket
  - listen on the socket and `chmod` socket file if practical
- On Windows:
  - listen on the named pipe endpoint
  - use the improved per-user/per-session pipe naming from Phase 1.5
- Handle one request per connection using shared core IPC helpers.
- Hold the server handle and close it on app quit.
- Remove the Unix socket on clean shutdown where appropriate.
- Define behavior for `EADDRINUSE`, `ECONNREFUSED`, timeout, invalid response, and oversized response.
- Implement methods:
  - `health`: return `OpenPetsHealthV2` with `protocolVersion: 2`, transport `ipc`, capabilities `event-v2`, `window-v1`, `speech-v1`
  - `event`: validate/apply event and return `{ state }`
  - `window`: run `show | hide | sleep | quit` and return `{ action }`
- Return `ready: false` when main process is alive but renderer/pet is not yet usable.

### Client transport

Rewrite `packages/client/src/client.ts` to be IPC-only.

Public API target:

```ts
type OpenPetsClientOptions = {
  endpoint?: string;
  timeoutMs?: number;
  verifyOpenPets?: boolean;
};
```

Behavior:

- `options.endpoint` beats `OPENPETS_IPC_ENDPOINT` / default endpoint resolution.
- `OPENPETS_IPC_ENDPOINT` overrides default IPC endpoint.
- Do not support `transport`, `baseUrl`, `OPENPETS_BASE_URL`, `OPENPETS_HTTP_URL`, or fixed localhost HTTP URLs.
- Add `windowAction(action)` to the client API.
- Keep `safeSendEvent()` default timeout at 400ms.
- Validate IPC health protocol version `2`.
- Validate health shape: `app === "openpets"`, `ok === true`, `protocolVersion === 2`, `transport === "ipc"`.
- Validate event response `state`.
- Validate window response `action`.
- Map IPC error responses to `OpenPetsClientError` consistently.

### CLI switch

Update `packages/cli/src/index.ts`:

- Do not reason about fixed integration ports.
- Use `getHealth()` over IPC for readiness.
- Use `sendEvent()` over IPC for manual event demos.
- Use client `windowAction()` for `show | hide | sleep | quit` when desktop is already running.
- Keep `start` responsible for launching Electron if IPC health says not running.
- Keep second-instance argv only for launch/start fallback if needed.
- Preserve running-instance behavior for `openpets start --pet ...` and `openpets start --scale ...` explicitly:
  - either keep second-instance argv handoff for these start-time configuration changes, or
  - add an IPC config method in a later phase before removing the second-instance path.
  - Do not silently regress current `--pet` / `--scale` behavior.

Validation:

- `bun test packages/core/src packages/client/src packages/cli/src`
- `bun run typecheck:core && bun run typecheck:client && bun run typecheck:cli && bun run typecheck:desktop`
- Manual smoke:
  - `openpets start`
  - `openpets event thinking --message "Testing IPC"`
  - `openpets hide`, `openpets show`, `openpets sleep`, `openpets quit`

Validation:

- Full package tests and typechecks.
- Search check for stale references to `4738`, `OPENPETS_BASE_URL`, `OPENPETS_HTTP_URL`, HTTP client transport, and localhost integration docs.

Review gate:

- Ask @oracle to review IPC-only rewrite safety and stale-contract cleanup.

## Phase 4 — MCP Package

Status: implemented.

Goal: add the preferred agent integration surface.

Sequencing decision:

- `openpets_health` and `openpets_set_state` landed first.
- `openpets_say` was enabled after renderer transient speech lifetime was implemented.

Package layout:

```txt
packages/mcp/
  package.json
  tsconfig.json
  src/index.ts
  src/server.ts
  src/tools.ts
  src/safety.ts
  src/safety.test.ts
  src/tools.test.ts
```

Tools:

- `openpets_say`
  - input: `{ state, message }`
  - allowed states: thinking, working, editing, running, testing, waiting, success, error
  - validates safety policy
  - rate-limits/dedupes
  - sends event `{ state, source: "mcp", type: "mcp.say", message }`
- `openpets_set_state`
  - input: `{ state }`
  - sends event `{ state, source: "mcp", type: `mcp.state.${state}` }`
- `openpets_health`
  - input: `{}`
  - concise result `{ running, activePet }`

Speech safety validation:

- max 100 characters
- Unicode normalize before validation
- one line only
- no control characters / ANSI escapes
- no markdown/code fences
- no URLs
- no absolute/relative/Windows paths
- no shell commands
- no obvious secrets/tokens
- no long hex/base64-looking strings
- no exact stack/log-looking text
- fail closed

MCP privacy/error behavior:

- Tool errors/results must not leak raw socket paths, local file paths, command output, stack traces, exact IPC internals, or secrets back to the agent.
- Diagnostics must go to stderr only.
- Stdout must remain MCP protocol only; no `console.log` diagnostics.

Rate-limit/dedupe policy:

- Define a minimum interval between `openpets_say` sends.
- Define a duplicate suppression window.
- Rejected/rate-limited messages should be no-op style results, not desktop events.
- Add tests for rate limit and duplicate suppression.

Validation:

- MCP safety/tool unit tests.
- MCP stdio smoke test if feasible.
- Client IPC tests must still pass.
- Confirm `openpets_say` is not broadly exposed until renderer speech lifetime is fixed.

Review gate:

- Ask @oracle to review MCP trust boundaries, stdout hygiene, and safety validation strictness.

## Phase 5 — Renderer Speech Lifetime and MCP Speech Enablement

Status: implemented.

Goal: make authored speech transient and safe for long-running states, then enable `openpets_say` broadly.

Behavior:

- Message bubbles auto-hide after about 4 seconds.
- Success/error messages may stay about 5 seconds.
- New message replaces old message.
- State remains long-running after message disappears.
- Separate message display lifetime from reducer state lifetime if needed.
- After this is validated, enable/register `openpets_say` by default.

Validation:

- Unit tests around reducer/render state if applicable.
- Manual UI smoke with MCP/client events.
- MCP `openpets_say` smoke after enablement.

Review gate:

- Ask @oracle for code-structure review, and use @designer if visual/UX behavior feels off.

## Phase 6 — Integration Repos + Docs Cleanup

Goal: make MCP the documented default for Claude/OpenCode while keeping hooks/plugins optional.

Deliverables:

- Update Claude setup docs/config to prefer MCP.
- Update OpenCode setup docs/config if MCP tools are supported in the desired workflow.
- Keep hook/plugin status mapping as optional secondary adapters.
- Update `docs/contracts.md` to define IPC protocol v2.
- Update quickstart to prefer MCP.
- Remove stale fixed-port examples as primary contract.

Validation:

- Search docs for stale primary localhost references.
- Run relevant package tests/typechecks.

Review gate:

- Ask @oracle for final architecture/docs consistency review.

## Implementation Todo Template

The active implementation todo list should include these review gates explicitly:

1. Phase 1 review by @oracle.
2. Phase 1.5 hardening implementation.
3. Phase 1.5 review by @oracle.
4. Phase 2 implementation.
5. Phase 2 review by @oracle.
6. Phase 3 implementation.
7. Phase 3 review by @oracle.
8. Phase 4 implementation with health/state tools.
9. Phase 4 review by @oracle.
10. Phase 5 implementation and `openpets_say` enablement.
11. Phase 5 review by @oracle / @designer if needed.
12. Phase 6 implementation.
13. Final @oracle review.
