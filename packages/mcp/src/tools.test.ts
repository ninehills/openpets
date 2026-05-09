import { describe, expect, test } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OpenPetsState } from "@open-pets/core";
import { openPetsStates } from "@open-pets/core";
import type { OpenPetsHealthV2 } from "@open-pets/core/ipc";
import { OpenPetsClientError } from "@open-pets/client";
import {
  createMcpLeaseManager,
  openPetsHealthTool,
  openPetsReleaseTool,
  openPetsSayTool,
  openPetsSetStateTool,
  openPetsStartTool,
  openPetsToolDescriptions,
  openPetsFieldDescriptions,
  openPetsStateGuidance,
  registerOpenPetsTools,
  type OpenPetsToolClient,
} from "./tools.js";
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
    expect(JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "{}" )).toEqual({ running: true, ready: true, started: false, activePet: "slayer", lease: true });
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
    expect(JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "{}" )).toEqual({ running: true, ready: true, started: true, activePet: "slayer", lease: true });
  });

  test("start waits for IPC health and acquires lease before renderer ready", async () => {
    let calls = 0;
    const leaseActions: string[] = [];
    const client = fakeClient({
      getHealth: async () => {
        calls += 1;
        if (calls === 1) throw new OpenPetsClientError("not-running", "missing");
        return validHealth({ ready: calls >= 4 });
      },
      leaseActions,
    });
    const result = await openPetsStartTool(client, async () => undefined, createMcpLeaseManager(client, { leaseId: "mcp:test", heartbeatIntervalMs: 60_000 }));
    expect(JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "{}" )).toMatchObject({ running: true, ready: true, started: true, lease: true });
    expect(leaseActions[0]).toBe("acquire");
  });

  test("start failures are generic", async () => {
    const result = await openPetsStartTool(fakeClient({ healthError: new OpenPetsClientError("not-running", "/tmp/socket") }), async () => { throw new Error("/secret/path"); });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.type === "text" ? result.content[0].text : "").toBe("OpenPets desktop could not be started.");
  });

  test("release releases only this MCP lease", async () => {
    const leaseActions: string[] = [];
    const client = fakeClient({ leaseActions });
    const manager = createMcpLeaseManager(client, { leaseId: "mcp:test", heartbeatIntervalMs: 60_000 });
    await manager.acquire();
    const result = await openPetsReleaseTool(manager);

    expect(JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "{}" )).toEqual({ released: true, running: true, activeLeases: 0 });
    expect(leaseActions).toEqual(["acquire", "release"]);
  });

  test("release ignores an in-flight heartbeat result", async () => {
    let resolveHeartbeat: ((value: { action: "heartbeat"; activeLeases: number; managed: boolean; leaseActive: boolean; changed: boolean }) => void) | undefined;
    const client: OpenPetsToolClient = {
      async getHealth() { return validHealth(); },
      async sendEvent(event) { return { ok: true as const, state: event.state as OpenPetsState }; },
      async leaseAcquire() { return { action: "acquire", activeLeases: 1, managed: false, leaseActive: true, changed: true }; },
      async leaseHeartbeat() {
        return new Promise((resolve) => {
          resolveHeartbeat = resolve;
        });
      },
      async leaseRelease() { return { action: "release", activeLeases: 0, managed: false, leaseActive: false, changed: true }; },
    };
    const manager = createMcpLeaseManager(client, { leaseId: "mcp:test", heartbeatIntervalMs: 60_000 });

    await manager.acquire();
    const heartbeat = manager.heartbeat();
    await manager.release();
    resolveHeartbeat?.({ action: "heartbeat", activeLeases: 1, managed: false, leaseActive: true, changed: true });
    await heartbeat;

    expect(manager.leaseAcquired).toBe(false);
  });

  test("set_state sends MCP state event", async () => {
    const events: unknown[] = [];
    const result = await openPetsSetStateTool(fakeClient({ events }), "testing");
    expect(JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "{}" )).toEqual({ state: "testing" });
    expect(events[0]).toMatchObject({ state: "testing", source: "mcp", type: "mcp.state.testing" });
  });

  test("set_state acquires and sends lease id when called before start", async () => {
    const events: unknown[] = [];
    const leaseActions: string[] = [];
    const client = fakeClient({ events, leaseActions });
    const manager = createMcpLeaseManager(client, { leaseId: "mcp:test-session" });

    await openPetsSetStateTool(client, "testing", manager);

    expect(leaseActions).toContain("acquire");
    expect(events[0]).toMatchObject({ state: "testing", source: "mcp:test-session", leaseId: "mcp:test-session" });
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
    expect(JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "{}")).toEqual({ sent: false, reason: "rate-limited" });
    expect(events).toHaveLength(1);
  });
});

describe("OpenPets MCP tool schema regression", () => {
  function captureRegisteredTools() {
    const registeredTools = new Map<string, { description: string; inputSchema?: unknown }>();
    const server = {
      registerTool: (name: string, meta: { description: string; inputSchema?: unknown }, _handler: unknown) => {
        registeredTools.set(name, { description: meta.description, inputSchema: meta.inputSchema });
      },
    } as unknown as McpServer;

    registerOpenPetsTools(server, fakeClient({}), createSpeechLimiter({ minIntervalMs: 0 }), async () => undefined);
    return registeredTools;
  }

  test("all five expected tool names are registered", () => {
    const names = [...captureRegisteredTools().keys()].sort();
    expect(names).toEqual(["openpets_health", "openpets_release", "openpets_say", "openpets_set_state", "openpets_start"]);
  });

  test("openpets_say description includes privacy categories", () => {
    const registeredTools = captureRegisteredTools();
    const description = registeredTools.get("openpets_say")?.description ?? "";
    expect(description).toBe(openPetsToolDescriptions.say);
    const privacyCategories = [
      "user text",
      "code",
      "file paths",
      "shell commands",
      "command output",
      "logs",
      "diffs",
      "URLs",
      "secrets",
      "tokens",
      "exact error messages",
      "private data",
    ];
    for (const category of privacyCategories) {
      expect(description).toContain(category);
    }
    expect(description).toContain("paraphrase");
  });

  test("final-response guidance prefers openpets_set_state and mentions success/error/warning", () => {
    const registeredTools = captureRegisteredTools();
    const sayDescription = registeredTools.get("openpets_say")?.description ?? "";
    const setStateDescription = registeredTools.get("openpets_set_state")?.description ?? "";
    expect(sayDescription).toContain("openpets_set_state");
    expect(sayDescription).toContain("success");
    expect(sayDescription).toContain("error");
    expect(sayDescription).toContain("warning");
    expect(setStateDescription).toContain("openpets_set_state");
    expect(setStateDescription).toContain("success");
    expect(setStateDescription).toContain("error");
    expect(setStateDescription).toContain("warning");
  });

  test("openpets_set_state description mentions without speech or silent", () => {
    const desc = captureRegisteredTools().get("openpets_set_state")?.description.toLowerCase() ?? "";
    expect(desc).toMatch(/without speech|silent/);
  });

  test("openpets_start mentions openpets_say/openpets_set_state and running false/health failure/unknown availability", () => {
    const desc = captureRegisteredTools().get("openpets_start")?.description.toLowerCase() ?? "";
    expect(desc).toContain("openpets_say");
    expect(desc).toContain("openpets_set_state");
    expect(desc).toContain("running is false");
    expect(desc).toContain("health fails");
    expect(desc).toContain("availability is unknown");
  });

  test("openPetsStateGuidance covers every openPetsStates value, including waving and celebrating", () => {
    for (const state of openPetsStates) {
      expect(openPetsStateGuidance[state]).toBeDefined();
      expect(openPetsStateGuidance[state].length).toBeGreaterThan(0);
    }
    expect(openPetsStateGuidance.waving).toBeDefined();
    expect(openPetsStateGuidance.celebrating).toBeDefined();
  });

  test("openpets_say state guidance does not include warning/celebrating/waving/sleeping/idle but openpets_set_state does", () => {
    const excludedStates = ["warning", "celebrating", "waving", "sleeping", "idle"];
    for (const state of excludedStates) {
      expect(openPetsFieldDescriptions.sayState).not.toContain(state);
    }
    for (const state of excludedStates) {
      expect(openPetsFieldDescriptions.setState).toContain(state);
    }
  });

  test("registered input schemas expose field descriptions", () => {
    const registeredTools = captureRegisteredTools();
    const sayShape = getInputShape(registeredTools.get("openpets_say")?.inputSchema);
    const setStateShape = getInputShape(registeredTools.get("openpets_set_state")?.inputSchema);

    expect(sayShape.state?.description).toBe(openPetsFieldDescriptions.sayState);
    expect(sayShape.message?.description).toBe(openPetsFieldDescriptions.sayMessage);
    expect(setStateShape.state?.description).toBe(openPetsFieldDescriptions.setState);
  });
});

function getInputShape(inputSchema: unknown) {
  return (inputSchema as { shape?: Record<string, { description?: string }> } | undefined)?.shape ?? {};
}

function fakeClient(options: { health?: OpenPetsHealthV2; healthError?: Error; events?: unknown[]; leaseActions?: string[]; getHealth?: OpenPetsToolClient["getHealth"] }): OpenPetsToolClient {
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
    async leaseAcquire(input) {
      options.leaseActions?.push("acquire");
      return { action: "acquire", activeLeases: 1, managed: false, leaseActive: true, changed: true };
    },
    async leaseHeartbeat() {
      options.leaseActions?.push("heartbeat");
      return { action: "heartbeat", activeLeases: 1, managed: false, leaseActive: true, changed: true };
    },
    async leaseRelease() {
      options.leaseActions?.push("release");
      return { action: "release", activeLeases: 0, managed: false, leaseActive: false, changed: true };
    },
  };
}

function validHealth(overrides: Partial<OpenPetsHealthV2> = {}): OpenPetsHealthV2 {
  return {
    app: "openpets",
    ok: true,
    version: "0.0.0",
    protocolVersion: 2,
    transport: "ipc",
    capabilities: ["event-v2", "window-v1", "lease-v1"],
    ready: overrides.ready ?? true,
    activePet: "slayer",
    activePets: [{ leaseId: "__default__", agentType: "default", detail: "", petName: "slayer", state: "idle" }],
    activeLeases: 0,
    managed: false,
    ...overrides,
  };
}
