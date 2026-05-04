import { afterEach, describe, expect, it } from "bun:test";
import { createServer, type Server } from "node:http";
import { createOpenPetsClient, safeSendEvent, sendEvent } from "./client.js";
import { OpenPetsClientError } from "./errors.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  servers.length = 0;
});

describe("@openpets/client", () => {
  it("gets health from OpenPets", async () => {
    const { baseUrl } = await startServer({ health: validHealth() });
    const client = createOpenPetsClient({ baseUrl });

    await expect(client.getHealth()).resolves.toMatchObject({ app: "openpets", protocolVersion: 1, ready: true });
  });

  it("rejects non-OpenPets health", async () => {
    const { baseUrl } = await startServer({ health: { app: "something-else" } });
    const client = createOpenPetsClient({ baseUrl });

    await expect(client.getHealth()).rejects.toMatchObject({ code: "not-openpets" });
  });

  it("verifies health before posting events", async () => {
    const { baseUrl, counts } = await startServer({ health: validHealth(), event: { ok: true, state: "thinking" } });
    const client = createOpenPetsClient({ baseUrl });

    await expect(client.sendEvent({ state: "thinking" })).resolves.toEqual({ ok: true, state: "thinking" });
    expect(counts.health).toBe(1);
    expect(counts.event).toBe(1);
  });

  it("caches successful verification for a client instance", async () => {
    const { baseUrl, counts } = await startServer({ health: validHealth(), event: { ok: true, state: "thinking" } });
    const client = createOpenPetsClient({ baseUrl });

    await client.sendEvent({ state: "thinking" });
    await client.sendEvent({ state: "thinking" });

    expect(counts.health).toBe(1);
    expect(counts.event).toBe(2);
  });

  it("skips health verification when verifyOpenPets is false but still posts", async () => {
    const { baseUrl, counts } = await startServer({ health: { app: "not-openpets" }, event: { ok: true, state: "thinking" } });
    const client = createOpenPetsClient({ baseUrl, verifyOpenPets: false });

    await expect(client.sendEvent({ state: "thinking" })).resolves.toEqual({ ok: true, state: "thinking" });

    expect(counts.health).toBe(0);
    expect(counts.event).toBe(1);
  });

  it("does not post when health is not OpenPets", async () => {
    const { baseUrl, counts } = await startServer({ health: { app: "other" }, event: { ok: true, state: "thinking" } });
    const client = createOpenPetsClient({ baseUrl });

    await expect(client.sendEvent({ state: "thinking" })).rejects.toMatchObject({ code: "not-openpets" });
    expect(counts.event).toBe(0);
  });

  it("rejects incompatible protocol versions", async () => {
    const { baseUrl } = await startServer({ health: { ...validHealth(), protocolVersion: 2 } });
    const client = createOpenPetsClient({ baseUrl });

    await expect(client.sendEvent({ state: "thinking" })).rejects.toMatchObject({ code: "incompatible-protocol" });
  });

  it("throws on invalid JSON", async () => {
    const { baseUrl } = await startServer({ healthRaw: "not json" });
    const client = createOpenPetsClient({ baseUrl });

    await expect(client.getHealth()).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("throws timeout errors", async () => {
    const { baseUrl } = await startServer({ health: validHealth(), healthDelayMs: 40 });
    const client = createOpenPetsClient({ baseUrl });

    await expect(client.getHealth({ timeoutMs: 5 })).rejects.toMatchObject({ code: "timeout" });
  });

  it("throws on rejected events", async () => {
    const { baseUrl } = await startServer({ health: validHealth(), event: { ok: false, error: "bad event" } });
    const client = createOpenPetsClient({ baseUrl });

    await expect(client.sendEvent({ state: "thinking" })).rejects.toMatchObject({ code: "rejected", message: "bad event" });
  });

  it("throws on invalid event response state", async () => {
    const { baseUrl } = await startServer({ health: validHealth(), event: { ok: true, state: "not-a-state" } });
    const client = createOpenPetsClient({ baseUrl });

    await expect(client.sendEvent({ state: "thinking" })).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("isRunning reflects health availability", async () => {
    const { baseUrl } = await startServer({ health: validHealth() });
    const client = createOpenPetsClient({ baseUrl });

    await expect(client.isRunning()).resolves.toBe(true);
    await expect(client.isRunning({ baseUrl: "http://127.0.0.1:9", timeoutMs: 50, verifyOpenPets: false })).resolves.toBe(false);
  });

  it("safeSendEvent returns errors instead of throwing", async () => {
    const result = await safeSendEvent({ state: "thinking" }, { baseUrl: "http://127.0.0.1:9", timeoutMs: 50 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(OpenPetsClientError);
  });

  it("uses shorthand event defaults", async () => {
    const bodies: unknown[] = [];
    const { baseUrl } = await startServer({ health: validHealth(), event: { ok: true, state: "waving" }, bodies });

    await sendEvent({ state: "waving" }, { baseUrl, verifyOpenPets: false });

    expect(bodies[0]).toMatchObject({ state: "waving", source: "client", type: "state.waving" });
  });
});

function validHealth() {
  return {
    app: "openpets",
    ok: true,
    version: "0.0.0",
    protocolVersion: 1,
    capabilities: ["event-v1"],
    ready: true,
    activePet: "slayer",
  };
}

async function startServer(options: {
  health?: unknown;
  healthRaw?: string;
  healthDelayMs?: number;
  event?: unknown;
  bodies?: unknown[];
}) {
  const counts = { health: 0, event: 0 };
  const server = createServer(async (request, response) => {
    if (request.url === "/health") {
      counts.health += 1;
      if (options.healthDelayMs) await Bun.sleep(options.healthDelayMs);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(options.healthRaw ?? JSON.stringify(options.health));
      return;
    }
    if (request.url === "/event") {
      counts.event += 1;
      let body = "";
      for await (const chunk of request) body += chunk;
      options.bodies?.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(options.event ?? { ok: true, state: "idle" }));
      return;
    }
    response.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP server address");
  return { baseUrl: `http://127.0.0.1:${address.port}`, counts };
}
