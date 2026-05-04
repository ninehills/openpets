export const DEFAULT_LEASE_TTL_MS = 120_000;
export const MIN_LEASE_TTL_MS = 30_000;
export const MAX_LEASE_TTL_MS = 600_000;
export const MAX_ACTIVE_LEASES = 128;
export const MAX_LEASE_ID_LENGTH = 120;
export const MAX_LEASE_LABEL_LENGTH = 80;

export type OpenPetsLeaseClient = "mcp" | "opencode" | "cli";

export type LeaseParams =
  | {
      action: "acquire";
      id: string;
      client: OpenPetsLeaseClient;
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

export type LeaseRecord = {
  id: string;
  client: OpenPetsLeaseClient;
  label?: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  autoClose: boolean;
};

export type LeaseResult = {
  action: LeaseParams["action"];
  activeLeases: number;
  managed: boolean;
  leaseActive: boolean;
  changed: boolean;
};

export type LeaseValidationResult =
  | { ok: true; params: LeaseParams }
  | { ok: false; error: string };

export type LeaseActionResult =
  | { ok: true; result: LeaseResult }
  | { ok: false; error: string };

export type LifecycleLeaseState = {
  leases: Map<string, LeaseRecord>;
  managed: boolean;
};

export type LifecycleLeaseOptions = {
  managed?: boolean;
  now?: number;
};

export function createLifecycleLeaseState(options: LifecycleLeaseOptions = {}): LifecycleLeaseState {
  return {
    leases: new Map(),
    managed: options.managed ?? false,
  };
}

export function validateLeaseParams(input: unknown): LeaseValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "lease params must be an object" };
  }

  const record = input as Record<string, unknown>;
  if (record.action !== "acquire" && record.action !== "heartbeat" && record.action !== "release") {
    return { ok: false, error: "unknown lease action" };
  }

  const id = validateLeaseId(record.id);
  if (!id.ok) return id;

  if (record.action === "release") {
    return { ok: true, params: { action: "release", id: id.value } };
  }

  let ttlMs: number | undefined;
  if (record.ttlMs !== undefined) {
    if (typeof record.ttlMs !== "number" || !Number.isFinite(record.ttlMs)) {
      return { ok: false, error: "ttlMs must be a finite number" };
    }
    ttlMs = clampLeaseTtlMs(record.ttlMs);
  }

  if (record.action === "heartbeat") {
    return { ok: true, params: { action: "heartbeat", id: id.value, ...(ttlMs === undefined ? {} : { ttlMs }) } };
  }

  if (!isOpenPetsLeaseClient(record.client)) {
    return { ok: false, error: "client must be mcp, opencode, or cli" };
  }

  const label = validateOptionalLeaseLabel(record.label);
  if (!label.ok) return label;

  if (record.autoClose !== undefined && typeof record.autoClose !== "boolean") {
    return { ok: false, error: "autoClose must be a boolean" };
  }

  return {
    ok: true,
    params: {
      action: "acquire",
      id: id.value,
      client: record.client,
      ...(label.value ? { label: label.value } : {}),
      ...(ttlMs === undefined ? {} : { ttlMs }),
      ...(record.autoClose === undefined ? {} : { autoClose: record.autoClose }),
    },
  };
}

export function applyLeaseAction(state: LifecycleLeaseState, params: LeaseParams, options: { now?: number } = {}): LeaseActionResult {
  const now = options.now ?? Date.now();
  pruneExpiredLeases(state, now);

  if (params.action === "release") {
    const changed = state.leases.delete(params.id);
    return { ok: true, result: createLeaseResult(state, params.action, false, changed) };
  }

  if (params.action === "heartbeat") {
    const lease = state.leases.get(params.id);
    if (!lease) {
      return { ok: true, result: createLeaseResult(state, params.action, false, false) };
    }
    lease.lastSeenAt = now;
    lease.expiresAt = now + clampLeaseTtlMs(params.ttlMs ?? DEFAULT_LEASE_TTL_MS);
    return { ok: true, result: createLeaseResult(state, params.action, true, true) };
  }

  const existing = state.leases.get(params.id);
  if (existing && existing.client !== params.client) {
    return { ok: false, error: "lease id already belongs to another client" };
  }
  if (!existing && state.leases.size >= MAX_ACTIVE_LEASES) {
    return { ok: false, error: "too many active leases" };
  }

  const ttlMs = clampLeaseTtlMs(params.ttlMs ?? DEFAULT_LEASE_TTL_MS);
  const autoClose = params.autoClose ?? defaultAutoCloseForClient(params.client);
  if (existing) {
    if (params.label) {
      existing.label = params.label;
    } else {
      delete existing.label;
    }
    existing.lastSeenAt = now;
    existing.expiresAt = now + ttlMs;
    existing.autoClose = autoClose;
  } else {
    state.leases.set(params.id, {
      id: params.id,
      client: params.client,
      ...(params.label ? { label: params.label } : {}),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + ttlMs,
      autoClose,
    });
  }

  return { ok: true, result: createLeaseResult(state, params.action, true, true) };
}

export function pruneExpiredLeases(state: LifecycleLeaseState, now = Date.now()) {
  let pruned = 0;
  for (const [id, lease] of state.leases) {
    if (lease.expiresAt <= now) {
      state.leases.delete(id);
      pruned += 1;
    }
  }
  return pruned;
}

export function getActiveLeaseCount(state: LifecycleLeaseState, now = Date.now()) {
  pruneExpiredLeases(state, now);
  return state.leases.size;
}

export function clampLeaseTtlMs(ttlMs: number) {
  return Math.min(MAX_LEASE_TTL_MS, Math.max(MIN_LEASE_TTL_MS, ttlMs));
}

export function defaultAutoCloseForClient(client: OpenPetsLeaseClient) {
  return client === "mcp";
}

export function isOpenPetsLeaseClient(value: unknown): value is OpenPetsLeaseClient {
  return value === "mcp" || value === "opencode" || value === "cli";
}

function createLeaseResult(state: LifecycleLeaseState, action: LeaseParams["action"], leaseActive: boolean, changed: boolean): LeaseResult {
  return {
    action,
    activeLeases: state.leases.size,
    managed: state.managed,
    leaseActive,
    changed,
  };
}

function validateLeaseId(value: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: "id must be a string" };
  if (hasControlCharacter(value)) return { ok: false, error: "id must not contain control characters" };
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: "id must be non-empty" };
  if (trimmed.length > MAX_LEASE_ID_LENGTH) return { ok: false, error: `id must be ${MAX_LEASE_ID_LENGTH} chars or less` };
  return { ok: true, value: trimmed };
}

function validateOptionalLeaseLabel(value: unknown): { ok: true; value?: string } | { ok: false; error: string } {
  if (value === undefined) return { ok: true };
  if (typeof value !== "string") return { ok: false, error: "label must be a string" };
  if (hasControlCharacter(value)) return { ok: false, error: "label must not contain control characters" };
  const trimmed = value.trim();
  if (trimmed.length > MAX_LEASE_LABEL_LENGTH) return { ok: false, error: `label must be ${MAX_LEASE_LABEL_LENGTH} chars or less` };
  return trimmed ? { ok: true, value: trimmed } : { ok: true };
}

function hasControlCharacter(value: string) {
  return /[\u0000-\u001f\u007f]/u.test(value);
}
