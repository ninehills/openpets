# OpenPets Lifecycle Leases Spec

## Problem

OpenPets can now be launched from Claude through the MCP `openpets_start` tool. The desktop pet is a singleton local app, so once launched it can outlive the Claude session that started it.

That is not always bad: users may want the pet to stay. But multiple clients can use the same pet at once:

- multiple Claude Code sessions
- OpenCode
- the CLI
- future local tools

We need cleanup semantics that avoid two bad outcomes:

1. A Claude-launched pet stays forever when the user expected it to be temporary.
2. One Claude session exits and accidentally closes a pet that another session/client is using.

## Product decision

OpenPets is a **shared user-level singleton**.

- Manual/user-started pet stays running until the user quits it.
- Agent-started pet can be tracked by a lightweight lease.
- One client can release only its own lease.
- No MCP global quit tool.
- Later, managed agent-started pets may auto-close after all leases expire/release and a grace period passes.

## Non-goals

- No `openpets_quit` MCP tool.
- No parent-process monitoring as the primary cleanup mechanism.
- No per-Claude-session desktop windows.
- No durable on-disk lease database in the first pass.
- No killing the desktop just because one MCP server disconnects.
- No raw Claude/OpenCode transcript or command data in lifecycle metadata.

## Terms

### Lease

A lease is a temporary claim that a client is actively using the shared pet.

```ts
type OpenPetsLease = {
  id: string;
  client: "mcp" | "opencode" | "cli";
  label?: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  autoClose: boolean;
};
```

### Desktop launch mode

```ts
type OpenPetsLaunchMode = "manual" | "managed";
```

- `manual`: user or CLI started the pet. Never auto-close from lease cleanup.
- `managed`: an agent/MCP tool launched the pet. Eligible for future auto-close after all leases are gone.

Initial implementation can track launch mode in memory only.

## Desktop lifecycle state

Add in-memory lifecycle state in the desktop main process:

```ts
type DesktopLifecycleState = {
  launchedMode: OpenPetsLaunchMode;
  leases: Map<string, OpenPetsLease>;
  lastActivityAt: number;
};
```

Implement lifecycle logic as a pure module so most behavior can be tested outside Electron:

```ts
createLifecycleState(now): DesktopLifecycleState;
acquireLease(state, input, now): LeaseResult;
heartbeatLease(state, input, now): LeaseResult;
releaseLease(state, id, now): LeaseResult;
pruneExpiredLeases(state, now): number;
getLifecycleHealth(state, now): { activeLeases: number; managed: boolean };
```

Prune expired leases:

- before health response
- before lease acquire/heartbeat/release result
- before future auto-close checks

Activity updates `lastActivityAt`:

- event received
- speech received
- state set
- window action
- renderer/user interaction if practical

Heartbeat does **not** update `lastActivityAt`; an active lease already keeps a managed pet alive. Activity is for user-visible pet usage and future auto-close grace logic.

## IPC protocol changes

Add a new IPC method:

```ts
type IpcRequest = {
  id: string;
  method: "health" | "event" | "window" | "lease";
  params?: unknown;
};
```

Lease params:

```ts
type LeaseParams =
  | {
      action: "acquire";
      id: string;
      client: "mcp" | "opencode" | "cli";
      label?: string;
      ttlMs?: number;
      autoClose?: boolean;
    }
  | {
      action: "heartbeat";
      id: string;
      ttlMs?: number;
    }
  | {
      action: "release";
      id: string;
    };
```

Lease response:

```ts
type LeaseResult = {
  action: "acquire" | "heartbeat" | "release";
  activeLeases: number;
  managed: boolean;
  leaseActive: boolean;
  changed: boolean;
};
```

Result semantics:

- `leaseActive`: true if the target lease exists after the operation.
- `changed`: true if the operation created, updated, extended, or removed a lease.
- `release` on an unknown lease returns `leaseActive: false`, `changed: false`.
- `heartbeat` on an unknown, released, or expired lease returns `leaseActive: false`, `changed: false` and **must not recreate** the lease.
- `acquire` is the only operation that creates/upserts a lease.

Validation rules:

- `id`: non-empty string, max 120 chars, printable non-control characters only, trimmed.
- `client`: exact enum.
- `label`: optional string, max 80 chars, trimmed, no control characters.
- `ttlMs`: optional finite number, clamp to a safe range.
- `autoClose`: optional boolean. Desktop normalizes defaults by client:
  - MCP default: `true`
  - OpenCode default: `false`
  - CLI default: `false`
- unknown lease actions are `invalid-params`.
- max active leases: 128 after pruning expired leases.
- if max active leases is exceeded, return `invalid-params` with generic message `too many active leases`.
- leases are coordination, not authorization.

Acquire/idempotency rules:

- acquire with a new id creates a lease.
- acquire with an existing id and same `client` updates `lastSeenAt`, `expiresAt`, `label`, and `autoClose`, while preserving `createdAt`.
- acquire with an existing id but different `client` is rejected as `invalid-params` to avoid accidental collision/impersonation.

Suggested TTLs:

```txt
default lease TTL: 120s
minimum lease TTL: 30s
maximum lease TTL: 10m
MCP heartbeat interval: 30s
```

## Health response changes

Extend `OpenPetsHealthV2`:

```ts
type OpenPetsHealthV2 = {
  app: "openpets";
  ok: true;
  version: string;
  protocolVersion: 2;
  transport: "ipc";
  capabilities: Array<"event-v2" | "window-v1" | "speech-v1" | "lease-v1">;
  ready: boolean;
  activePet: string | null;
  activeLeases: number;
  managed: boolean;
  debug?: boolean;
  window?: unknown;
};
```

Do not expose raw lease IDs in normal health. Debug mode may include more details later.

New desktop implementations should always emit `activeLeases` and `managed`. Clients may parse them defensively for older desktops.

## Client API changes

Add lifecycle methods to `@openpets/client`:

```ts
type OpenPetsLeaseClient = "mcp" | "opencode" | "cli";

type OpenPetsLeaseInput = {
  id: string;
  client: OpenPetsLeaseClient;
  label?: string;
  ttlMs?: number;
  autoClose?: boolean;
};

leaseAcquire(input: OpenPetsLeaseInput, options?: OpenPetsClientOptions): Promise<LeaseResult>;
leaseHeartbeat(input: { id: string; ttlMs?: number }, options?: OpenPetsClientOptions): Promise<LeaseResult>;
leaseRelease(id: string, options?: OpenPetsClientOptions): Promise<LeaseResult>;
```

Keep these as normal exported client helpers. They are not primary CLI UX.

## MCP changes

### Lease ID

Each MCP server process generates one stable lease ID at startup:

```txt
mcp:<random-uuid>
```

Use this ID for all lease operations from that MCP process.

MCP keeps process-local lifecycle state:

```ts
type OpenPetsMcpLifecycle = {
  leaseId: string;
  leaseAcquired: boolean;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
};
```

### `openpets_start`

Current behavior:

- checks health
- launches desktop if not running
- waits until ready

New behavior:

- if desktop is already running and ready: acquire/refresh this MCP lease, return started false.
- if desktop is running but not ready: acquire the lease as soon as IPC health is reachable, then wait for ready.
- if desktop is not running: launch desktop, wait for IPC health reachable, acquire lease, then wait until ready.

Rationale: slow renderer/pet loading should not leave a managed desktop running without a lease.

Result shape:

```json
{
  "running": true,
  "ready": true,
  "started": true,
  "activePet": "slayer",
  "lease": true
}
```

Errors remain generic; do not leak paths or raw IPC details.

Map lease acquire result into MCP response:

- `lease: result.leaseActive`
- start should only begin heartbeat if acquire succeeds and `leaseActive === true`.
- if acquire returns `unknown-method`, do not start heartbeat; return normal start health with `lease: false` or a concise non-fatal tool result.

### Heartbeat

After `openpets_start` successfully acquires a lease, MCP starts a heartbeat timer:

```txt
every 30s → leaseHeartbeat(leaseId)
```

The heartbeat timer stops when the MCP server exits or `openpets_release` succeeds.

Release race rules:

- MCP marks heartbeat inactive and clears the heartbeat timer **before** sending release.
- Desktop heartbeat on an unknown/released/expired lease never recreates the lease.
- heartbeat timer should call `unref()` when available so it does not keep the MCP process alive by itself.

### `openpets_release`

Add a new tool:

```txt
openpets_release
```

Description:

```txt
Release this Claude/OpenPets session's use of the desktop pet. This does not globally quit OpenPets and will not close a pet used by another session.
```

Response:

```json
{
  "released": true,
  "running": true,
  "activeLeases": 1
}
```

If desktop is not running, return success-like concise state:

```json
{ "released": false, "running": false, "activeLeases": 0 }
```

Map IPC release result into MCP response:

- `released: result.changed`
- `activeLeases: result.activeLeases`
- release on unknown lease is a non-error with `released: false`.
- release when desktop is not running is a non-error with `{ released: false, running: false, activeLeases: 0 }`.

### `openpets_say` and `openpets_set_state`

If this MCP process has an acquired lease, these tools should refresh/heartbeat before or after sending the event.

Do not implicitly acquire a lease in `say`/`set_state` unless `openpets_start` has been called. This keeps ownership intentional.

## Desktop cleanup semantics

### Phase 1: leases only, no auto-quit

Implement first:

- lease IPC method
- in-memory lease map
- lease expiry cleanup
- health includes `activeLeases` and `managed`
- MCP start acquires lease
- MCP release tool
- MCP heartbeat

Do **not** auto-quit yet. This gives observability and prevents accidental shared-session shutdown.

### Phase 2: managed auto-close

Later, add managed launch:

- MCP launcher starts desktop with `--openpets-managed`.
- Desktop sets `launchedMode = "managed"` from argv.
- Manual CLI start remains `manual`.
- Manual wins: `--openpets-managed` from a second-instance event must never downgrade an already-manual desktop to managed.
- If a manual start races a managed start, the resulting desktop should be treated as manual whenever manual intent is observed.
- If managed and all leases are gone/expired, wait a grace period then quit.

Suggested grace:

```txt
no leases grace: 2–5 minutes
recent activity grace: 5 minutes
```

If user interacts with the pet manually, switch to `manual`.

Decision: user interaction switches a managed desktop to manual, because user interaction implies ownership.

## Multiple-session behavior

### Multiple Claude sessions

Each Claude Code session has its own MCP server process and lease ID.

```txt
Claude A → lease mcp:A
Claude B → lease mcp:B
Claude A release/expiry → lease A removed
Desktop stays alive because lease B exists
Claude B release/expiry → no leases remain
Later managed auto-close may quit if launched managed
```

### Claude + OpenCode

Initial OpenCode plugin sends events and updates `lastActivityAt` but does not acquire a lease.

If OpenCode needs to keep managed pets alive later, add OpenCode lease heartbeat in `opencode-pets`.

### CLI

CLI `openpets quit` remains a global user-intent command.

No MCP tool should call global quit.

## Shutdown / disconnect handling

MCP should attempt best-effort lease release on:

- `SIGINT`
- `SIGTERM`
- `beforeExit`
- normal process close if possible

But correctness must rely on TTL expiry, not signal handling. Claude/MCP process cleanup can be unreliable.

## Compatibility / capability behavior

Desktop health includes `lease-v1` in capabilities when lease IPC is supported.

MCP/client behavior:

- If lease method returns `unknown-method`, MCP should still be able to use existing health/start/say/set_state behavior, but release/heartbeat should report concise non-fatal failure.
- Implementation may require `lease-v1` for `openpets_release` to report meaningful lease state.
- Do not expose raw protocol errors to the agent.

## Tests

### Core IPC tests

- validates lease acquire params
- validates heartbeat params
- validates release params
- rejects unknown lease action
- dispatches lease method
- heartbeat unknown lease does not create lease
- acquire same ID twice is idempotent
- acquire same ID with different client is rejected
- max lease count enforced after pruning expired leases

### Desktop tests if practical

- acquire creates lease
- heartbeat extends lease
- release removes lease
- expired leases are dropped
- health activeLeases reflects current leases
- expired leases are not counted in health
- running but not ready desktop can accept lease

### Client tests

- `leaseAcquire` sends IPC method and validates result
- `leaseHeartbeat` validates result
- `leaseRelease` validates result
- invalid response rejected

### MCP tests

- `openpets_start` acquires lease when already running
- `openpets_start` launches then acquires lease when not running
- `openpets_release` releases only current lease
- heartbeat starts after lease acquire
- release stops heartbeat
- not-running release returns safe concise result
- release clears heartbeat before sending release
- late heartbeat after release does not reacquire

### Race/edge tests

- two MCP sessions concurrently start from not-running
- managed launch races with manual launch; manual remains manual
- heartbeat after TTL expiry returns `leaseActive: false`
- existing desktop without `lease-v1` capability produces safe generic MCP behavior

## Open questions

- Should manual user interaction switch managed desktop to manual immediately, or only extend grace?
- Should `openpets_start` always acquire lease if already running, even if desktop was manually started? Recommendation: yes, but releasing that lease must not quit manual desktop.
- Should health show `activeLeases` always or only when nonzero? Recommendation: always.
- Should CLI expose lease commands? Recommendation: not in primary help; internal/client API first.
