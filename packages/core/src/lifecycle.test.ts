import { describe, expect, test } from "bun:test";
import {
  MAX_ACTIVE_LEASES,
  MAX_LEASE_TTL_MS,
  MIN_LEASE_TTL_MS,
  applyLeaseAction,
  clampLeaseTtlMs,
  createLifecycleLeaseState,
  defaultAutoCloseForClient,
  getActiveLeaseCount,
  validateLeaseParams,
} from "./lifecycle.js";

describe("lifecycle leases", () => {
  test("validates and normalizes acquire params", () => {
    expect(validateLeaseParams({ action: "acquire", id: " lease-1 ", client: "mcp", label: " Claude ", ttlMs: 1, autoClose: false })).toEqual({
      ok: true,
      params: { action: "acquire", id: "lease-1", client: "mcp", label: "Claude", ttlMs: MIN_LEASE_TTL_MS, autoClose: false },
    });
  });

  test("rejects invalid params", () => {
    expect(validateLeaseParams({ action: "bad", id: "lease-1" })).toMatchObject({ ok: false });
    expect(validateLeaseParams({ action: "acquire", id: "lease-1\n", client: "mcp" })).toMatchObject({ ok: false });
    expect(validateLeaseParams({ action: "acquire", id: "lease-1", client: "browser" })).toMatchObject({ ok: false });
    expect(validateLeaseParams({ action: "heartbeat", id: "lease-1", ttlMs: Number.NaN })).toMatchObject({ ok: false });
  });

  test("acquires, heartbeats, and releases leases", () => {
    const state = createLifecycleLeaseState({ managed: true });
    expect(applyLeaseAction(state, { action: "acquire", id: "mcp:1", client: "mcp", ttlMs: 60_000 }, { now: 1000 })).toEqual({
      ok: true,
      result: { action: "acquire", activeLeases: 1, managed: true, leaseActive: true, changed: true },
    });

    expect(applyLeaseAction(state, { action: "heartbeat", id: "mcp:1", ttlMs: 120_000 }, { now: 2000 })).toEqual({
      ok: true,
      result: { action: "heartbeat", activeLeases: 1, managed: true, leaseActive: true, changed: true },
    });

    expect(applyLeaseAction(state, { action: "release", id: "mcp:1" }, { now: 3000 })).toEqual({
      ok: true,
      result: { action: "release", activeLeases: 0, managed: true, leaseActive: false, changed: true },
    });
  });

  test("heartbeat and release do not recreate unknown leases", () => {
    const state = createLifecycleLeaseState();
    expect(applyLeaseAction(state, { action: "heartbeat", id: "missing" }, { now: 1000 })).toEqual({
      ok: true,
      result: { action: "heartbeat", activeLeases: 0, managed: false, leaseActive: false, changed: false },
    });
    expect(applyLeaseAction(state, { action: "release", id: "missing" }, { now: 1000 })).toEqual({
      ok: true,
      result: { action: "release", activeLeases: 0, managed: false, leaseActive: false, changed: false },
    });
  });

  test("preserves createdAt for same-client idempotent acquire", () => {
    const state = createLifecycleLeaseState();
    expect(applyLeaseAction(state, { action: "acquire", id: "lease", client: "mcp", label: "one" }, { now: 1000 }).ok).toBe(true);
    expect(applyLeaseAction(state, { action: "acquire", id: "lease", client: "mcp", label: "two" }, { now: 2000 }).ok).toBe(true);
    expect(state.leases.get("lease")).toMatchObject({ createdAt: 1000, lastSeenAt: 2000, label: "two" });
  });

  test("rejects id collision across clients", () => {
    const state = createLifecycleLeaseState();
    expect(applyLeaseAction(state, { action: "acquire", id: "shared", client: "mcp" }, { now: 1000 }).ok).toBe(true);
    expect(applyLeaseAction(state, { action: "acquire", id: "shared", client: "cli" }, { now: 2000 })).toEqual({ ok: false, error: "lease id already belongs to another client" });
  });

  test("prunes expired leases before counting and acquiring", () => {
    const state = createLifecycleLeaseState();
    expect(applyLeaseAction(state, { action: "acquire", id: "old", client: "mcp", ttlMs: MIN_LEASE_TTL_MS }, { now: 1000 }).ok).toBe(true);
    expect(getActiveLeaseCount(state, 1000 + MIN_LEASE_TTL_MS + 1)).toBe(0);
    expect(applyLeaseAction(state, { action: "acquire", id: "new", client: "mcp" }, { now: 1000 + MIN_LEASE_TTL_MS + 1 }).ok).toBe(true);
  });

  test("enforces max active leases", () => {
    const state = createLifecycleLeaseState();
    for (let index = 0; index < MAX_ACTIVE_LEASES; index += 1) {
      expect(applyLeaseAction(state, { action: "acquire", id: `lease-${index}`, client: "mcp" }, { now: 1000 }).ok).toBe(true);
    }
    expect(applyLeaseAction(state, { action: "acquire", id: "overflow", client: "mcp" }, { now: 1000 })).toEqual({ ok: false, error: "too many active leases" });
  });

  test("clamps ttl and defaults auto-close by client", () => {
    expect(clampLeaseTtlMs(1)).toBe(MIN_LEASE_TTL_MS);
    expect(clampLeaseTtlMs(Number.MAX_SAFE_INTEGER)).toBe(MAX_LEASE_TTL_MS);
    expect(defaultAutoCloseForClient("mcp")).toBe(true);
    expect(defaultAutoCloseForClient("opencode")).toBe(false);
    expect(defaultAutoCloseForClient("cli")).toBe(false);
  });
});
