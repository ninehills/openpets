# OpenPets Client + Integration Repo Dev Setup Implementation Spec

## Goal

Implement a local-development setup that lets us build `claude-pets` and `opencode-pets` as dedicated repositories before publishing `@openpets/client`.

This spec turns `docs/openpets-client-plan.md` into executable implementation steps.

## Non-goals

- Do not publish packages yet.
- Do not preserve legacy OpenPets CLI integration commands.
- Do not build a large SDK.
- Do not duplicate desktop rendering, pet loading, or Electron lifecycle in integration repos.
- Do not introduce backwards-compatibility shims for `openpets hook claude-code` or `openpets integrate ...`.

## Local development layout

Keep the main repository at:

```txt
/home/alvin/openpets
```

Create sibling local repositories/directories:

```txt
/home/alvin/claude-pets
/home/alvin/opencode-pets
```

These should be separate git repositories eventually. During initial implementation they can be regular sibling directories with their own `package.json`, TypeScript config, tests, and README.

Use `file:` dependencies to consume local OpenPets packages before publishing. The sibling repos must consume buildable package boundaries, not Bun workspace internals:

```json
{
  "dependencies": {
    "@openpets/client": "file:../openpets/packages/client"
  }
}
```

`@openpets/client` must not expose sibling repos to `workspace:*` transitive dependency failures. Before using it from `/home/alvin/claude-pets` or `/home/alvin/opencode-pets`, make both `@openpets/core` and `@openpets/client` build to `dist` with Node-compatible ESM exports.

Local sibling repo validation is required before implementation is considered done:

```bash
cd /home/alvin/openpets
bun run build:packages

cd /home/alvin/claude-pets
bun install
bun run typecheck
bun test
```

If Bun cannot install `file:../openpets/packages/client` because `@openpets/client` depends on `@openpets/core` via `workspace:*`, use one of these explicit local-dev options instead of guessing:

1. set `@openpets/client`'s local dependency on core to `file:../core` until publish prep, or
2. add sibling repo overrides/resolutions for `@openpets/core` to `file:../openpets/packages/core`, or
3. pack local tarballs for `@openpets/core` and `@openpets/client` and install those tarballs.

Preferred initial path: omit `@openpets/core` from `packages/client/package.json` dependencies during local sibling-repo development, and make sibling repos explicitly depend on both local packages with `file:`. The main OpenPets monorepo workspace itself provides core for local client builds. Before publishing, add the normal published `@openpets/core` dependency range. If Bun cannot resolve the local setup, use local tarballs generated after `bun run build:packages`.

## Phase 0: Make `@openpets/core` buildable/publishable

`@openpets/client` depends on `@openpets/core`. Since the client must be Node 18+/Bun compatible and publishable from `dist`, core must also stop being source-only for package consumers.

### Files to update

```txt
packages/core/package.json
packages/core/tsconfig.json
```

### `packages/core/package.json`

Change exports from `src` to `dist`:

```json
{
  "name": "@openpets/core",
  "version": "0.0.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./config": {
      "types": "./dist/config.d.ts",
      "import": "./dist/config.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "bunx tsc -p tsconfig.json",
    "test": "bun test",
    "typecheck": "bunx tsc -p tsconfig.json --noEmit"
  }
}
```

### TypeScript emit rules for publishable packages

For `packages/core` and `packages/client`, use Node-compatible ESM emit:

- `module`: `NodeNext`
- `moduleResolution`: `NodeNext`
- TS source imports that will emit to JS must include `.js` specifiers for relative imports.
- Tests must not be emitted to `dist`.

Example package `tsconfig.json` shape:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "allowImportingTsExtensions": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

If this creates too much churn for all workspace package imports, limit the NodeNext/buildable conversion to `packages/core` and `packages/client` first.

## Phase 1: Add `@openpets/client`

### Files

Create:

```txt
packages/client/
  package.json
  tsconfig.json
  src/
    index.ts
    client.ts
    errors.ts
    event-input.ts
  src/client.test.ts
```

Tests can live under `src`, but package `tsconfig.json` must exclude `src/**/*.test.ts` from emit.

### `packages/client/package.json`

Use a publishable ESM package shape:

```json
{
  "name": "@openpets/client",
  "version": "0.0.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "bunx tsc -p tsconfig.json",
    "typecheck": "bunx tsc -p tsconfig.json --noEmit",
    "test": "bun test"
  }
}
```

During local external-repo development, sibling repos must explicitly depend on both `@openpets/client` and `@openpets/core` via `file:` or tarballs until packages are published.

### `packages/client/tsconfig.json`

Emit JS and declarations using Node-compatible ESM:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "allowImportingTsExtensions": false,
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

Use `.js` suffixes in relative TypeScript imports inside `packages/client` so emitted ESM works in Node:

```ts
export { createOpenPetsClient } from "./client.js";
```

If inherited `allowImportingTsExtensions` conflicts with emit, override it in package configs as above. Do not add Bun-only import behavior to publishable packages.

### Public exports

`src/index.ts` should export:

```ts
export type {
  OpenPetsClient,
  OpenPetsClientOptions,
  OpenPetsEventInput,
  OpenPetsHealth,
  OpenPetsSafeResult,
} from "./client.js";
export {
  createOpenPetsClient,
  getHealth,
  isOpenPetsRunning,
  safeSendEvent,
  sendEvent,
} from "./client.js";
export { OpenPetsClientError } from "./errors.js";
export type { OpenPetsClientErrorCode } from "./errors.js";
export type { OpenPetsEvent, OpenPetsState } from "@openpets/core";
export { createManualEvent, isOpenPetsState, validateOpenPetsEvent } from "@openpets/core";
```

This intentionally makes the relevant `@openpets/core` types/helpers public. If core should not become public, duplicate-free alternatives must be chosen before implementation; current direction treats core as a public foundation package.

### API

Primary API is object-based:

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

export type OpenPetsSafeResult =
  | { ok: true; state?: OpenPetsState }
  | { ok: false; error: OpenPetsClientError };

export type OpenPetsClient = {
  getHealth(options?: OpenPetsClientOptions): Promise<OpenPetsHealth>;
  isRunning(options?: OpenPetsClientOptions): Promise<boolean>;
  sendEvent(event: OpenPetsEventInput, options?: OpenPetsClientOptions): Promise<{ ok: true; state: OpenPetsState }>;
  safeSendEvent(event: OpenPetsEventInput, options?: OpenPetsClientOptions): Promise<OpenPetsSafeResult>;
};
```

Top-level functions are convenience wrappers around a default client:

```ts
createOpenPetsClient(options?: OpenPetsClientOptions): OpenPetsClient
getHealth(options?: OpenPetsClientOptions): Promise<OpenPetsHealth>
isOpenPetsRunning(options?: OpenPetsClientOptions): Promise<boolean>
sendEvent(event: OpenPetsEventInput, options?: OpenPetsClientOptions): Promise<{ ok: true; state: OpenPetsState }>
safeSendEvent(event: OpenPetsEventInput, options?: OpenPetsClientOptions): Promise<OpenPetsSafeResult>
```

### Event input

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

Event normalization algorithm:

1. If input already passes `validateOpenPetsEvent`, preserve it exactly, including timestamp.
2. Otherwise, if input has a valid `state`, call `createManualEvent` from `@openpets/core` with defaults.
3. Validate the normalized event before POST.

For shorthand input, defaults are:

- `source`: `client`
- `type`: `state.${state}`

Then validate with `validateOpenPetsEvent` before sending.

### Base URL resolution

Resolve base URL in this order:

1. method call option
2. client creation option
3. `process.env.OPENPETS_BASE_URL`
4. `http://127.0.0.1:4738`

Keep compatibility with browser-ish runtimes by guarding `process` access:

```ts
const envBaseUrl = typeof process !== "undefined" ? process.env.OPENPETS_BASE_URL : undefined;
```

### Timeouts

Defaults:

- `getHealth`: `1000ms`
- `sendEvent`: `1000ms`
- `safeSendEvent`: `400ms` total budget for verification plus POST

Use `AbortController`. Always clear timeout handles.

Top-level `safeSendEvent` should use a module-level default client so verification cache can help repeated hook calls within the same process. For one-shot hook processes, caching may not help; the 400ms timeout is still a total budget.

### Verification before POST

Default `verifyOpenPets` is `true`.

Before the first `POST /event` for a client instance, call `GET /health` and require:

- `app === "openpets"`
- `protocolVersion === 1`

Cache this positive verification per client instance.

If verification fails:

- `sendEvent` throws `OpenPetsClientError`
- `safeSendEvent` returns `{ ok: false, error }`

Allow `verifyOpenPets: false` only for tests or controlled environments.

### Error model

Create `OpenPetsClientError` with codes:

```ts
export type OpenPetsClientErrorCode =
  | "not-running"
  | "timeout"
  | "not-openpets"
  | "invalid-response"
  | "incompatible-protocol"
  | "rejected"
  | "network-error";
```

Map common failures:

- connection refused / fetch failure before response: `not-running` or `network-error`
- abort: `timeout`
- health response missing `app: "openpets"`: `not-openpets`
- health response has unsupported protocol version: `incompatible-protocol`
- invalid JSON: `invalid-response`
- `/event` non-2xx or `{ ok: false }`: `rejected`

## Phase 2: Update desktop `/health`

In `apps/desktop/src/main.ts`, add to `/health` response:

```ts
protocolVersion: 1,
capabilities: ["event-v1"],
```

Do this before client verification is enabled.

## Phase 3: Refactor main CLI to use `@openpets/client`

### Package dependency

Add to `packages/cli/package.json`:

```json
"@openpets/client": "workspace:*"
```

### Remove direct local API helpers

Delete from `packages/cli/src/index.ts`:

- `HOST`
- `BASE_URL`
- direct `postJson`
- direct `getHealth`

Use:

- `getHealth` from `@openpets/client`
- `sendEvent` from `@openpets/client`

Keep CLI-specific behavior:

- detect non-OpenPets service on port via client error or health result
- launch desktop for `start` and `show`
- wait for readiness with a polling loop

Update root package scripts:

```json
{
  "scripts": {
    "build:packages": "bun run build:core && bun run build:client",
    "build:core": "cd packages/core && bun run build",
    "build:client": "cd packages/client && bun run build",
    "typecheck": "bun run typecheck:core && bun run typecheck:client && bun run typecheck:pet-format-codex && bun run typecheck:cli && bun run typecheck:desktop",
    "typecheck:client": "bunx tsc -p packages/client/tsconfig.json --noEmit",
    "test": "bun test packages/core/src packages/pet-format-codex/src packages/client/src packages/cli/src"
  }
}
```

### Remove host integration commands

Delete command handling for:

- `hook`
- `integrate`

Delete functions from CLI:

- `hook`
- `integrate`
- `hookClaudeCode`
- `mapClaudeHookToEvent`
- `installClaudeCodeSnippet`
- `installOpenCodePlugin`
- Claude settings merge helpers if no longer used
- backup helpers if no longer used

Delete files:

```txt
packages/cli/src/integrations/claude-code.ts
packages/cli/src/integrations/opencode.ts
```

Also delete or move any CLI tests that import those files, especially:

```txt
packages/cli/src/integrations.test.ts
```

Deletion order for safety:

1. Create `/home/alvin/claude-pets` and `/home/alvin/opencode-pets` by copying/moving current integration logic.
2. Get their tests passing against local `@openpets/client`.
3. Then delete the in-repo CLI integration commands/files/tests.

Update CLI help to show:

```txt
Claude Code integration: bunx claude-pets install
OpenCode integration:    bunx opencode-pets install
```

## Phase 4: Create `/home/alvin/claude-pets`

### Files

```txt
/home/alvin/claude-pets/
  package.json
  tsconfig.json
  README.md
  src/
    cli.ts
    hook.ts
    install.ts
    map-claude-event.ts
    settings.ts
  src/map-claude-event.test.ts
```

### `package.json`

Use a local dev dependency on OpenPets client:

```json
{
  "name": "claude-pets",
  "version": "0.0.0",
  "type": "module",
  "bin": {
    "claude-pets": "./src/cli.ts"
  },
  "dependencies": {
    "@openpets/client": "file:../openpets/packages/client",
    "@openpets/core": "file:../openpets/packages/core"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.9.3"
  },
  "scripts": {
    "dev": "bun src/cli.ts",
    "test": "bun test",
    "typecheck": "bunx tsc -p tsconfig.json --noEmit"
  }
}
```

For local hook command execution, choose one explicit dev strategy:

- run `bun link` in `/home/alvin/claude-pets` so `claude-pets hook` exists on PATH, or
- generate Claude settings using an absolute command: `bun /home/alvin/claude-pets/src/cli.ts hook`.

Recommended for local development: absolute `bun .../src/cli.ts hook`, because it does not depend on global links. Before publishing, switch the printed/default snippet to `claude-pets hook`.

Add a shebang to `src/cli.ts`:

```ts
#!/usr/bin/env bun
```

### Commands

```bash
claude-pets install
claude-pets print
claude-pets hook
claude-pets test-event <state>
```

Behavior:

- `install`: merge `.claude/settings.local.json`, backup existing file before write
- `print`: print settings snippet
- `hook`: read JSON from stdin, map to event, call `safeSendEvent`
- `test-event`: send a manual test event with source `claude-pets`

### Claude settings snippet

Use `claude-pets hook`, not `openpets hook claude-code`. In local development, the command may be absolute as described above.

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "claude-pets hook" }] }],
    "PreToolUse": [
      {
        "matcher": "Bash|Edit|Write|MultiEdit",
        "hooks": [{ "type": "command", "command": "claude-pets hook" }]
      }
    ],
    "PermissionRequest": [{ "hooks": [{ "type": "command", "command": "claude-pets hook" }] }],
    "Notification": [{ "hooks": [{ "type": "command", "command": "claude-pets hook" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "claude-pets hook" }] }],
    "StopFailure": [{ "hooks": [{ "type": "command", "command": "claude-pets hook" }] }]
  }
}
```

### Mapping

Move existing mapping from CLI, with source changed to `claude-pets` or keep protocol source as `claude-code`.

Recommended event source: `claude-code` because it describes the originating host.

Mapping:

- `UserPromptSubmit` → `thinking`
- `PreToolUse` + `Edit|Write|MultiEdit` → `editing`
- `PreToolUse` + `Bash` test command → `testing`
- `PreToolUse` + `Bash` non-test command → `running`
- `PermissionRequest` → `waving`
- `Notification` → `waiting`
- `Stop` → `success`
- `StopFailure` → `error`

## Phase 5: Create `/home/alvin/opencode-pets`

### Files

```txt
/home/alvin/opencode-pets/
  package.json
  tsconfig.json
  README.md
  src/
    cli.ts
    install.ts
    plugin-template.ts
    map-opencode-event.ts
  src/map-opencode-event.test.ts
```

### `package.json`

```json
{
  "name": "opencode-pets",
  "version": "0.0.0",
  "type": "module",
  "bin": {
    "opencode-pets": "./src/cli.ts"
  },
  "dependencies": {
    "@openpets/client": "file:../openpets/packages/client",
    "@openpets/core": "file:../openpets/packages/core"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.9.3"
  },
  "scripts": {
    "dev": "bun src/cli.ts",
    "test": "bun test",
    "typecheck": "bunx tsc -p tsconfig.json --noEmit"
  }
}
```

Add a shebang to `src/cli.ts`:

```ts
#!/usr/bin/env bun
```

### Commands

```bash
opencode-pets install
opencode-pets print-plugin
opencode-pets test-event <state>
```

Behavior:

- `install`: write `.opencode/plugins/openpets.ts`, backup existing file before replace
- `print-plugin`: print plugin source
- `test-event`: send manual test event with source `opencode-pets`

### Plugin implementation decision

First validate whether OpenCode project plugins can import external packages from project dependencies.

If yes, generated plugin can import `@openpets/client`.

If no, generated plugin should be self-contained and include:

- base URL resolution from `OPENPETS_BASE_URL`
- `GET /health` verification
- `POST /event`
- 400ms timeout
- swallow errors

Do not block the implementation on publishing `@openpets/client`; this is why the local generated plugin fallback exists.

Recommended initial path: generate a self-contained plugin first. Switch to importing `@openpets/client` only after OpenCode dependency resolution is validated.

### Mapping

Move existing OpenCode mapping from CLI plugin template into pure functions where possible.

Mapping:

- `session.status` busy → `thinking`
- `session.status` idle → `idle`
- `permission.asked` → `waving`
- `session.error` → `error`
- `tool.execute.before` bash test command → `testing`
- `tool.execute.before` bash non-test command → `running`
- `tool.execute.before` edit/write/multiedit/patch/apply_patch → `editing`
- other `tool.execute.before` → `working`
- `tool.execute.after` success → `success`
- `tool.execute.after` error → `error`

## Tests

### `@openpets/client`

Use a local HTTP test server. Cover:

- `getHealth` succeeds with valid OpenPets response
- `getHealth` rejects non-OpenPets response
- `sendEvent` verifies health before event POST
- `sendEvent` does not POST when health is non-OpenPets
- `sendEvent` rejects incompatible protocol version
- `sendEvent` throws on timeout
- `sendEvent` throws on invalid JSON
- `sendEvent` throws on `{ ok: false }`
- `safeSendEvent` returns `{ ok: false, error }` instead of throwing
- shorthand event input uses defaults and validates

### CLI

Update existing CLI tests:

- invalid pet path still fails
- zip pet still rejected
- help no longer includes `openpets hook claude-code`
- help points to `claude-pets install` and `opencode-pets install`

### `claude-pets`

- mapping tests for each Claude hook event
- non-object/unknown input returns null/no-op
- settings merge preserves existing hooks and dedupes entries

### `opencode-pets`

- mapping tests for session/tool events
- test command detection
- edit tool detection
- plugin output contains expected OpenPets event calls or self-contained protocol helper

## Validation commands

From `/home/alvin/openpets`:

```bash
bun install
bun run build:packages
bun run typecheck
bun test packages/core/src packages/pet-format-codex/src packages/client/src packages/cli/src
bun run build
```

From `/home/alvin/claude-pets`:

```bash
bun install
bun run typecheck
bun test
```

From `/home/alvin/opencode-pets`:

```bash
bun install
bun run typecheck
bun test
```

Manual smoke tests after implementation:

```bash
cd /home/alvin/openpets
bun packages/cli/src/index.ts start --pet ./examples/pets/slayer --scale 1

cd /home/alvin/claude-pets
bun src/cli.ts test-event thinking

cd /home/alvin/opencode-pets
bun src/cli.ts test-event thinking
```

## Acceptance checklist

- `@openpets/client` exists and is publishable from `dist`.
- `@openpets/core` exists and is publishable/buildable from `dist`.
- Sibling `file:` installs are validated from `/home/alvin/claude-pets` and `/home/alvin/opencode-pets`.
- Desktop `/health` includes `protocolVersion: 1` and `capabilities`.
- CLI uses `@openpets/client` for health and event calls.
- CLI no longer has `hook` or `integrate` commands.
- `packages/cli/src/integrations/*` is removed.
- `/home/alvin/claude-pets` can install dependencies locally and call `@openpets/client`.
- `/home/alvin/opencode-pets` can install dependencies locally and call or vendor equivalent `@openpets/client` behavior.
- All relevant typechecks/tests/builds pass.
