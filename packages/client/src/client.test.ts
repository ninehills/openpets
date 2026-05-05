import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleIpcSocket, type IpcDispatcherHandlers } from "@open-pets/core/ipc";
import { createOpenPetsClient, safeSendEvent, sendEvent } from "./client.js";
import { OpenPetsClientError } from "./errors.js";

const servers: Server[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("@open-pets/client IPC", () => {
  it("gets health from OpenPets over IPC", async () => {
    const endpoint = await startIpcServer({ health: () => validHealth(), event: () => ({}), window: () => ({}), lease: () => ({}) });
    const client = createOpenPetsClient({ endpoint });

    await expect(client.getHealth()).resolves.toMatchObject({ app: "openpets", protocolVersion: 2, transport: "ipc", ready: true });
  });

  it("rejects non-OpenPets health", async () => {
    const endpoint = await startIpcServer({ health: () => ({ app: "something-else" }), event: () => ({}), window: () => ({}) });
    const client = createOpenPetsClient({ endpoint });

    await expect(client.getHealth()).rejects.toMatchObject({ code: "not-openpets" });
  });

  it("verifies health before sending events", async () => {
    const counts = { health: 0, event: 0 };
    const endpoint = await startIpcServer({
      health: () => { counts.health += 1; return validHealth(); },
      event: (event) => { counts.event += 1; return { state: event.state }; },
      window: () => ({}),
    });
    const client = createOpenPetsClient({ endpoint });

    await expect(client.sendEvent({ state: "thinking" })).resolves.toEqual({ ok: true, state: "thinking" });
    expect(counts).toEqual({ health: 1, event: 1 });
  });

  it("caches successful verification for a client instance", async () => {
    const counts = { health: 0, event: 0 };
    const endpoint = await startIpcServer({
      health: () => { counts.health += 1; return validHealth(); },
      event: (event) => { counts.event += 1; return { state: event.state }; },
      window: () => ({}),
    });
    const client = createOpenPetsClient({ endpoint });

    await client.sendEvent({ state: "thinking" });
    await client.sendEvent({ state: "thinking" });

    expect(counts).toEqual({ health: 1, event: 2 });
  });

  it("skips health verification when verifyOpenPets is false", async () => {
    const counts = { health: 0, event: 0 };
    const endpoint = await startIpcServer({
      health: () => { counts.health += 1; return { app: "not-openpets" }; },
      event: (event) => { counts.event += 1; return { state: event.state }; },
      window: () => ({}),
    });
    const client = createOpenPetsClient({ endpoint, verifyOpenPets: false });

    await expect(client.sendEvent({ state: "thinking" })).resolves.toEqual({ ok: true, state: "thinking" });
    expect(counts).toEqual({ health: 0, event: 1 });
  });

  it("does not send when health is not OpenPets", async () => {
    const counts = { event: 0 };
    const endpoint = await startIpcServer({ health: () => ({ app: "other" }), event: () => { counts.event += 1; return {}; }, window: () => ({}) });
    const client = createOpenPetsClient({ endpoint });

    await expect(client.sendEvent({ state: "thinking" })).rejects.toMatchObject({ code: "not-openpets" });
    expect(counts.event).toBe(0);
  });

  it("rejects incompatible protocol versions", async () => {
    const endpoint = await startIpcServer({ health: () => ({ ...validHealth(), protocolVersion: 1 }), event: () => ({}), window: () => ({}) });
    const client = createOpenPetsClient({ endpoint });

    await expect(client.sendEvent({ state: "thinking" })).rejects.toMatchObject({ code: "incompatible-protocol" });
  });

  it("throws timeout errors", async () => {
    const endpoint = await startIpcServer({ health: async () => { await Bun.sleep(40); return validHealth(); }, event: () => ({}), window: () => ({}) });
    const client = createOpenPetsClient({ endpoint });

    await expect(client.getHealth({ timeoutMs: 5 })).rejects.toMatchObject({ code: "timeout" });
  });

  it("throws on invalid event response state", async () => {
    const endpoint = await startIpcServer({ health: () => validHealth(), event: () => ({ state: "not-a-state" }), window: () => ({}) });
    const client = createOpenPetsClient({ endpoint });

    await expect(client.sendEvent({ state: "thinking" })).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("rejects oversized IPC responses", async () => {
    const endpoint = await startRawIpcServer((socket) => {
      socket.end(`${JSON.stringify({ id: "health", ok: true, result: { text: "x".repeat(20 * 1024) } })}\n`);
    });
    const client = createOpenPetsClient({ endpoint });

    await expect(client.getHealth()).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("rejects mismatched IPC response ids", async () => {
    const endpoint = await startRawIpcServer((socket) => {
      socket.end(`${JSON.stringify({ id: "wrong", ok: true, result: validHealth() })}\n`);
    });
    const client = createOpenPetsClient({ endpoint });

    await expect(client.getHealth()).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("supports window actions", async () => {
    const endpoint = await startIpcServer({ health: () => validHealth(), event: () => ({}), window: (action) => ({ action }) });
    const client = createOpenPetsClient({ endpoint });

    await expect(client.windowAction("hide")).resolves.toEqual({ ok: true, action: "hide" });
  });

  it("supports lease acquire, heartbeat, and release", async () => {
    const bodies: unknown[] = [];
    const endpoint = await startIpcServer({
      health: () => validHealth(),
      event: () => ({}),
      window: () => ({}),
      lease: (params) => {
        bodies.push(params);
        return { action: params.action, activeLeases: params.action === "release" ? 0 : 1, managed: false, leaseActive: params.action !== "release", changed: true };
      },
    });
    const client = createOpenPetsClient({ endpoint });

    expect(await client.leaseAcquire({ id: "mcp:1", client: "mcp", label: "Claude" })).toEqual({ action: "acquire", activeLeases: 1, managed: false, leaseActive: true, changed: true });
    await expect(client.leaseHeartbeat({ id: "mcp:1", ttlMs: 60_000 })).resolves.toEqual({ action: "heartbeat", activeLeases: 1, managed: false, leaseActive: true, changed: true });
    await expect(client.leaseRelease("mcp:1")).resolves.toEqual({ action: "release", activeLeases: 0, managed: false, leaseActive: false, changed: true });
    expect(bodies).toEqual([
      { action: "acquire", id: "mcp:1", client: "mcp", label: "Claude" },
      { action: "heartbeat", id: "mcp:1", ttlMs: 60_000 },
      { action: "release", id: "mcp:1" },
    ]);
  });

  it("rejects invalid lease responses", async () => {
    const endpoint = await startIpcServer({ health: () => validHealth(), event: () => ({}), window: () => ({}), lease: () => ({ action: "acquire" }) });
    const client = createOpenPetsClient({ endpoint });

    await expect(client.leaseAcquire({ id: "mcp:1", client: "mcp" })).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("isRunning reflects health availability", async () => {
    const endpoint = await startIpcServer({ health: () => validHealth(), event: () => ({}), window: () => ({}) });
    const client = createOpenPetsClient({ endpoint });

    await expect(client.isRunning()).resolves.toBe(true);
    await expect(client.isRunning({ endpoint: join(tmpdir(), "missing-openpets.sock"), timeoutMs: 50, verifyOpenPets: false })).resolves.toBe(false);
  });

  it("safeSendEvent returns errors instead of throwing", async () => {
    const result = await safeSendEvent({ state: "thinking" }, { endpoint: join(tmpdir(), "missing-openpets.sock"), timeoutMs: 50 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(OpenPetsClientError);
  });

  it("uses shorthand event defaults", async () => {
    const bodies: unknown[] = [];
    const endpoint = await startIpcServer({
      health: () => validHealth(),
      event: (event) => { bodies.push(event); return { state: event.state }; },
      window: () => ({}),
    });

    await sendEvent({ state: "waving" }, { endpoint, verifyOpenPets: false });

    expect(bodies[0]).toMatchObject({ state: "waving", source: "client", type: "state.waving" });
  });
});

function validHealth() {
  return {
    app: "openpets",
    ok: true,
    version: "0.0.0",
    protocolVersion: 2,
    transport: "ipc",
    capabilities: ["event-v2", "window-v1", "speech-v1", "lease-v1"],
    ready: true,
    activePet: "slayer",
    activeLeases: 0,
    managed: false,
  };
}

async function startIpcServer(handlers: IpcDispatcherHandlers) {
  const dir = await mkdtemp(join(tmpdir(), "openpets-client-ipc-"));
  tempDirs.push(dir);
  const endpoint = join(dir, "openpets.sock");
  const server = createServer((socket) => handleIpcSocket(socket, handlers));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(endpoint, resolve));
  return endpoint;
}

async function startRawIpcServer(handler: (socket: Socket) => void) {
  const dir = await mkdtemp(join(tmpdir(), "openpets-client-ipc-"));
  tempDirs.push(dir);
  const endpoint = join(dir, "openpets.sock");
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(endpoint, resolve));
  return endpoint;
}
