# OpenPets Client Plan

## Direction

Create a small, stable `@openpets/client` package in this repository before splitting Claude Code and OpenCode integrations into dedicated repositories.

The dedicated integration repositories should be thin host adapters:

- `claude-pets`: Claude Code hook installer, hook runtime, Claude-event-to-OpenPets mapping, Claude-specific docs.
- `opencode-pets`: OpenCode plugin installer, plugin runtime, OpenCode-event-to-OpenPets mapping, OpenCode-specific docs.

Both should depend on `@openpets/client` instead of reimplementing local HTTP calls, event validation, timeout handling, and no-op behavior.

This is a rewrite boundary, not a compatibility-preservation exercise. Existing integration code in `packages/cli` should be moved, deleted, or replaced where the new shape is cleaner. Do not preserve legacy helper APIs, command names, hidden aliases, or internal behavior unless they are still the best user experience.

Decision: `@openpets/client` must be publishable before `claude-pets` and `opencode-pets` are usable. External repositories should not depend on workspace-only packages.

## Why a client package, not a large SDK

Use the public name `@openpets/client` for now.

Avoid calling it `@openpets/sdk` until the surface area includes more than local API access. “SDK” implies broader commitments: plugin abstractions, pet authoring APIs, runtime embedding, compatibility layers, and long-term support guarantees. Phase 1 only needs a reliable local protocol client.

The client should be boring and dependable:

- send events to the local OpenPets desktop app
- check health/readiness
- no-op safely when OpenPets is not running
- provide shared TypeScript types
- centralize timeout and protocol behavior

It should not include host-specific Claude Code or OpenCode logic.

## Target architecture

```txt
openpets/
  packages/core
  packages/client
  packages/pet-format-codex
  packages/cli
  apps/desktop

claude-pets/
  depends on @openpets/client
  owns Claude Code hooks + install flow

opencode-pets/
  depends on @openpets/client
  owns OpenCode plugin + install flow
```

Runtime flow:

```txt
Claude Code / OpenCode
        ↓
claude-pets / opencode-pets
        ↓
@openpets/client
        ↓
http://127.0.0.1:4738/event
        ↓
OpenPets desktop app
```

## Package responsibilities

### `@openpets/client`

Owns local API access and protocol ergonomics.

Responsibilities:

- default endpoint: `http://127.0.0.1:4738`
- `GET /health`
- `POST /event`
- short request timeouts suitable for hooks/plugins
- safe no-op send for agent hooks
- event input construction helpers
- exported public types from `@openpets/core`
- clear error classification for callers that care

Non-responsibilities:

- launching the Electron app
- installing Claude Code hooks
- installing OpenCode plugins
- mapping Claude/OpenCode events
- loading/rendering pets
- managing Codex/Petdex assets
- WebSocket subscriptions
- cloud, marketplace, accounts, telemetry

### `packages/cli`

After the rewrite, the CLI should use `@openpets/client` for local API calls.

Keep CLI responsibilities focused on:

- starting/stopping/showing/hiding desktop
- sending manual events
- pet path validation for `openpets start --pet`
- debug/dev convenience

Remove host-specific integration installers from the main CLI as part of the rewrite:

- remove `openpets integrate claude-code`
- remove `openpets hook claude-code`
- remove `openpets integrate opencode`

No published or documented bridge commands. During local development, temporary migration commands may exist only on short-lived branches and should not ship.

### `claude-pets`

Owns all Claude Code-specific behavior.

Likely package shape:

```txt
claude-pets/
  package.json
  README.md
  src/
    cli.ts
    hook.ts
    install.ts
    map-claude-event.ts
```

Likely commands:

```bash
bunx claude-pets install
bunx claude-pets hook
bunx claude-pets test-event thinking
```

`install` should merge project-local `.claude/settings.local.json` safely and create backups when modifying existing files.

`hook` should read Claude hook JSON from stdin, map it to an OpenPets event, and call `safeSendEvent`. It must never break Claude Code if OpenPets is missing, stopped, or slow.

### `opencode-pets`

Owns all OpenCode-specific behavior.

Likely package shape:

```txt
opencode-pets/
  package.json
  README.md
  src/
    cli.ts
    install.ts
    plugin.ts
    map-opencode-event.ts
```

Likely commands:

```bash
bunx opencode-pets install
bunx opencode-pets print-plugin
bunx opencode-pets test-event thinking
```

`install` should create project-local `.opencode/plugins/openpets.ts` and back up an existing file before replacing it.

The generated plugin should use `@openpets/client` if OpenCode plugin resolution can import npm packages reliably. Validate this before implementing the final `opencode-pets` installer. If imports are unreliable, `opencode-pets` should generate a small self-contained protocol client in `.opencode/plugins/openpets.ts` that follows the same timeout, health verification, and error behavior as `@openpets/client`.

## Public client API proposal

```ts
import type { OpenPetsEvent, OpenPetsState } from "@openpets/client";
import {
  createOpenPetsClient,
  getHealth,
  isOpenPetsRunning,
  safeSendEvent,
  sendEvent,
} from "@openpets/client";
```

### Types

```ts
export type OpenPetsClientOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  verifyOpenPets?: boolean;
};

export type OpenPetsHealth = {
  app: "openpets";
  ok: boolean;
  version: string;
  protocolVersion: 1;
  capabilities: string[];
  ready: boolean;
  activePet: string | null;
  debug?: boolean;
  window?: unknown;
};

export type OpenPetsClientErrorCode =
  | "not-running"
  | "timeout"
  | "not-openpets"
  | "invalid-response"
  | "rejected"
  | "network-error";

export class OpenPetsClientError extends Error {
  code: OpenPetsClientErrorCode;
  status?: number;
}

export type OpenPetsSafeResult =
  | { ok: true; state?: OpenPetsState }
  | { ok: false; error: OpenPetsClientError };

export type OpenPetsClient = {
  getHealth(options?: OpenPetsClientOptions): Promise<OpenPetsHealth>;
  isRunning(options?: OpenPetsClientOptions): Promise<boolean>;
  sendEvent(
    event: OpenPetsEventInput,
    options?: OpenPetsClientOptions,
  ): Promise<{ ok: true; state: OpenPetsState }>;
  safeSendEvent(
    event: OpenPetsEventInput,
    options?: OpenPetsClientOptions,
  ): Promise<OpenPetsSafeResult>;
};
```

### Functions

Use an object client as the primary API. Top-level functions are convenience wrappers around `createOpenPetsClient()`.

```ts
export function createOpenPetsClient(options?: OpenPetsClientOptions): OpenPetsClient;

export async function getHealth(options?: OpenPetsClientOptions): Promise<OpenPetsHealth>;

export async function isOpenPetsRunning(options?: OpenPetsClientOptions): Promise<boolean>;

export async function sendEvent(
  event: OpenPetsEventInput,
  options?: OpenPetsClientOptions,
): Promise<{ ok: true; state: OpenPetsState }>;

export async function safeSendEvent(
  event: OpenPetsEventInput,
  options?: OpenPetsClientOptions,
): Promise<OpenPetsSafeResult>;
```

`safeSendEvent` should never throw for normal delivery failures. This is the correct primitive for hooks and plugins. Hooks can ignore the returned result; debug commands and tests can inspect it.

`sendEvent` should throw `OpenPetsClientError` when the event cannot be delivered or the app rejects it. This is the correct primitive for CLI commands and tests.

## Event input design

The client should allow concise event creation while still validating against `@openpets/core` before sending.

```ts
export type OpenPetsEventInput =
  | OpenPetsEvent
  | {
      state: OpenPetsState;
      source?: string;
      type?: string;
      message?: string;
      tool?: string;
    };
```

For shorthand inputs, apply defaults:

- `source`: caller-provided or `client`
- `type`: caller-provided or `state.${state}`
- timestamp/id generation should stay in `@openpets/core` helpers if available

Do not duplicate state lists or validation logic in the client. Re-export from `@openpets/core`.

## Timeout behavior

Defaults should favor host responsiveness:

- `safeSendEvent`: `400ms` default timeout
- `sendEvent`: `1000ms` default timeout
- `getHealth`: `1000ms` default timeout

Allow overrides via options.

Implementation should use `AbortController` and clear timers reliably.

`@openpets/client` must be Bun and Node compatible. Do not use Bun-only APIs. Minimum runtime target: Node 18+ or Bun with global `fetch` and `AbortController`.

The default `baseUrl` should be read in this order:

1. explicit `baseUrl` option
2. `OPENPETS_BASE_URL`
3. `http://127.0.0.1:4738`

## Protocol stability

The local HTTP protocol remains the stable integration boundary:

- `GET /health`
- `POST /event`
- JSON only
- local host only
- browser-origin requests rejected by desktop
- `/health` returns `app: "openpets"`, `protocolVersion: 1`, and `capabilities`

`@openpets/client` should be a typed wrapper around this protocol, not a replacement for it.

To avoid leaking hook data to a non-OpenPets service on port `4738`, the client should verify the server before sending events. Default behavior:

- `sendEvent` calls `GET /health` before the first `POST /event` for a client instance.
- The client caches a successful `app: "openpets"` + compatible `protocolVersion` verification for that instance.
- `verifyOpenPets: false` can skip this only for tests or controlled environments.
- `safeSendEvent` follows the same verification behavior but returns `{ ok: false, error }` instead of throwing.

Desktop should add `protocolVersion: 1` and `capabilities` to `/health` before external repos are published.

## Rewrite plan

### Step 1: Add `packages/client`

- Create package skeleton.
- Depend on `@openpets/core`.
- Implement `getHealth`, `sendEvent`, `safeSendEvent`, `isOpenPetsRunning`, and `createOpenPetsClient`.
- Add unit tests using a local test HTTP server.
- Add explicit ESM package exports:

```json
{
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

- Keep dependencies tiny: `@openpets/core` only; no Electron, CLI, pet-format, or Bun dependencies.
- Test cases: healthy OpenPets, not running, timeout, non-OpenPets service, invalid JSON, incompatible protocol version, and `/event` rejection.

### Step 2: Refactor main CLI to use `@openpets/client`

- Replace direct `fetch` helpers in `packages/cli`.
- Keep manual `openpets event <state>` behavior.
- Keep window/app launch behavior in CLI.
- Remove duplicated timeout/error handling.

### Step 3: Publish `@openpets/client`

- Publish the package before creating external integration repos.
- Lock v1 local protocol semantics before publish.
- Confirm package name/scope availability.

### Step 4: Create `claude-pets` repository

- Move Claude Code mapping and install logic out of `packages/cli`.
- Use `@openpets/client.safeSendEvent` in hook runtime.
- Add install, print, and test-event commands.
- Document `bunx openpets start` + `bunx claude-pets install`.
- Keep mapping functions pure and unit-tested separately from install/runtime code.

### Step 5: Create `opencode-pets` repository

- Move OpenCode plugin template and install logic out of `packages/cli`.
- Use `@openpets/client.safeSendEvent` where package imports work.
- If OpenCode plugin package imports are unreliable, generate a small self-contained plugin that follows the same protocol and timeout rules.
- Document `bunx openpets start` + `bunx opencode-pets install`.
- Keep mapping functions pure and unit-tested separately from install/runtime code.

### Step 6: Delete host integration commands from `openpets` CLI

Delete these from this repo in the same implementation sequence as the dedicated repos:

- `openpets hook claude-code`
- `openpets integrate claude-code`
- `openpets integrate opencode`

Replace help text with pointers:

```txt
Claude Code: bunx claude-pets install
OpenCode:    bunx opencode-pets install
```

Do not keep hidden compatibility paths.

## Repository release sequence

1. Add `protocolVersion: 1` and `capabilities` to desktop `/health`.
2. Implement and publish `@openpets/client` from this repo.
3. Create `claude-pets` repo using the published package.
4. Create `opencode-pets` repo using the published package.
5. Remove in-repo host integration code from `openpets`.
6. Update OpenPets README to point to dedicated integration repos.

## Open questions

- Can OpenCode project plugins import npm packages reliably in all supported environments, or should `opencode-pets` generate a self-contained plugin file?
- Should `safeSendEvent` expose optional debug logging, or should host integrations own logging?
- Are `claude-pets` and `opencode-pets` package/repository names available?
