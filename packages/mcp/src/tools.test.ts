import { describe, expect, test } from "bun:test";
import type { OpenPetsState } from "@openpets/core";
import type { OpenPetsHealthV2 } from "@openpets/core/ipc";
import { OpenPetsClientError } from "@openpets/client";
import { openPetsHealthTool, openPetsSayTool, openPetsSetStateTool, openPetsStartTool, type OpenPetsToolClient } from "./tools.js";
import { createSpeechLimiter } from "./safety.js";

describe("OpenPets MCP tools", () => {
  test("health returns concise running status", async () => {
    const result = await openPetsHealthTool(fakeClient({ health: validHealth() }));
    expect(JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "{}" )).toEqual({ running: true, activePet: "slayer" });
  });

  test("health reports not running without leaking internals", async () => {
    const result = await openPetsHealthTool(fakeClient({ healthError: new OpenPetsClientError("not-running", "socket /tmp/openpets.sock missing") }));
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "{}" )).toEqual({ running: false, activePet: null });
  });

  test("health failures are generic", async () => {
    const result = await openPetsHealthTool(fakeClient({ healthError: new Error("/secret/path failed") }));
    expect(result.isError).toBe(true);
    expect(result.content[0]?.type === "text" ? result.content[0].text : "").toBe("OpenPets health check failed.");
  });

  test("start returns existing running desktop without launching", async () => {
    let launched = false;
    const result = await openPetsStartTool(fakeClient({ health: validHealth() }), async () => { launched = true; });
    expect(JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "{}" )).toEqual({ running: true, ready: true, started: false, activePet: "slayer" });
    expect(launched).toBe(false);
  });

  test("start launches and waits for health", async () => {
    let calls = 0;
    const client = fakeClient({
      getHealth: async () => {
        calls += 1;
        if (calls < 2) throw new OpenPetsClientError("not-running", "missing");
        return validHealth();
      },
    });
    const result = await openPetsStartTool(client, async () => undefined);
    expect(JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "{}" )).toEqual({ running: true, ready: true, started: true, activePet: "slayer" });
  });

  test("start failures are generic", async () => {
    const result = await openPetsStartTool(fakeClient({ healthError: new OpenPetsClientError("not-running", "/tmp/socket") }), async () => { throw new Error("/secret/path"); });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.type === "text" ? result.content[0].text : "").toBe("OpenPets desktop could not be started.");
  });

  test("set_state sends MCP state event", async () => {
    const events: unknown[] = [];
    const result = await openPetsSetStateTool(fakeClient({ events }), "testing");
    expect(JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "{}" )).toEqual({ state: "testing" });
    expect(events[0]).toMatchObject({ state: "testing", source: "mcp", type: "mcp.state.testing" });
  });

  test("set_state rejects invalid states", async () => {
    const result = await openPetsSetStateTool(fakeClient({}), "nope");
    expect(result.isError).toBe(true);
    expect(result.content[0]?.type === "text" ? result.content[0].text : "").toBe("Invalid OpenPets state.");
  });

  test("say sends safe speech events", async () => {
    const events: unknown[] = [];
    const result = await openPetsSayTool(fakeClient({ events }), createSpeechLimiter({ minIntervalMs: 0 }), "working", "I’m checking the next step.");
    expect(JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "{}" )).toEqual({ sent: true, state: "working" });
    expect(events[0]).toMatchObject({ state: "working", source: "mcp", type: "mcp.say", message: "I’m checking the next step." });
    expect(events[0]).toHaveProperty("timestamp");
  });

  test("say rejects unsafe speech without sending", async () => {
    const events: unknown[] = [];
    const result = await openPetsSayTool(fakeClient({ events }), createSpeechLimiter({ minIntervalMs: 0 }), "working", "I’m editing src/auth/session.ts.");
    expect(result.isError).toBe(true);
    expect(events).toEqual([]);
  });

  test("say rate limits without sending", async () => {
    const events: unknown[] = [];
    const limiter = createSpeechLimiter({ minIntervalMs: 1000 });
    await openPetsSayTool(fakeClient({ events }), limiter, "working", "First safe update.");
    const result = await openPetsSayTool(fakeClient({ events }), limiter, "working", "Second safe update.");
    expect(JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "{}" )).toEqual({ sent: false, reason: "rate-limited" });
    expect(events).toHaveLength(1);
  });
});

function fakeClient(options: { health?: OpenPetsHealthV2; healthError?: Error; events?: unknown[]; getHealth?: OpenPetsToolClient["getHealth"] }): OpenPetsToolClient {
  return {
    async getHealth() {
      if (options.getHealth) return options.getHealth();
      if (options.healthError) throw options.healthError;
      return options.health ?? validHealth();
    },
    async sendEvent(event) {
      options.events?.push(event);
      return { ok: true as const, state: event.state as OpenPetsState };
    },
  };
}

function validHealth(): OpenPetsHealthV2 {
  return {
    app: "openpets",
    ok: true,
    version: "0.0.0",
    protocolVersion: 2,
    transport: "ipc",
    capabilities: ["event-v2", "window-v1"],
    ready: true,
    activePet: "slayer",
  };
}
