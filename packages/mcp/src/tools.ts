import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createOpenPetsClient, OpenPetsClientError, type OpenPetsClient } from "@open-pets/client";
import { isOpenPetsState, openPetsStates, type OpenPetsState } from "@open-pets/core";
import * as z from "zod/v4";
import { launchOpenPetsDesktop, sleep, type DesktopLauncher } from "./launcher.js";
import { createSpeechLimiter, validateSpeechMessage, type SpeechLimiter } from "./safety.js";

export type OpenPetsToolClient = Pick<OpenPetsClient, "getHealth" | "sendEvent" | "leaseAcquire" | "leaseHeartbeat" | "leaseRelease">;

export type OpenPetsLeaseManager = {
  readonly leaseId: string;
  readonly leaseAcquired: boolean;
  acquire(): Promise<boolean>;
  heartbeat(): Promise<boolean>;
  release(): Promise<{ released: boolean; running: boolean; activeLeases: number }>;
};

const sayStates = ["thinking", "working", "editing", "running", "testing", "waiting", "success", "error"] as const satisfies readonly OpenPetsState[];
type SayState = (typeof sayStates)[number];

export function registerOpenPetsTools(
  server: McpServer,
  client: OpenPetsToolClient = createOpenPetsClient(),
  limiter: SpeechLimiter = createSpeechLimiter(),
  launcher: DesktopLauncher = launchOpenPetsDesktop,
) {
  const leaseManager = createMcpLeaseManager(client);
  server.registerTool(
    "openpets_health",
    {
      description: "Check whether the OpenPets desktop pet is reachable locally.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => openPetsHealthTool(client),
  );

  server.registerTool(
    "openpets_start",
    {
      description: "Launch the local OpenPets desktop pet if it is not already running. Use this before OpenPets speech or state tools when health says running is false.",
      inputSchema: z.object({}),
      annotations: { idempotentHint: true },
    },
    async () => openPetsStartTool(client, launcher, leaseManager),
  );

  server.registerTool(
    "openpets_release",
    {
      description: "Release this Claude/OpenPets session's use of the desktop pet. This does not globally quit OpenPets and will not close a pet used by another session.",
      inputSchema: z.object({}),
      annotations: { idempotentHint: true },
    },
    async () => openPetsReleaseTool(leaseManager),
  );

  server.registerTool(
    "openpets_say",
    {
      description: "Send a short safe progress update to the OpenPets desktop pet. Use occasionally during work when a brief status would help the user feel progress. Do not include user text, code, file paths, shell commands, command output, logs, diffs, URLs, secrets, tokens, exact error messages, or private data. Keep it under 100 characters and one sentence.",
      inputSchema: z.object({
        state: z.enum(sayStates).describe("Display state for the speech bubble."),
        message: z.string().describe("Short safe one-sentence progress message."),
      }),
    },
    async ({ state, message }) => openPetsSayTool(client, limiter, state, message, leaseManager),
  );

  server.registerTool(
    "openpets_set_state",
    {
      description: "Set the OpenPets desktop pet status without speech.",
      inputSchema: z.object({
        state: z.enum(openPetsStates).describe("OpenPets state."),
      }),
    },
    async ({ state }) => openPetsSetStateTool(client, state, leaseManager),
  );
}

export function createMcpLeaseManager(client: OpenPetsToolClient, options: { leaseId?: string; heartbeatIntervalMs?: number } = {}): OpenPetsLeaseManager {
  const leaseId = options.leaseId ?? `mcp:${process.pid}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;
  let acquired = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let generation = 0;

  async function acquire() {
    const opGeneration = generation;
    const result = await client.leaseAcquire({ id: leaseId, client: "mcp", label: "Claude MCP", autoClose: true });
    if (opGeneration !== generation) return false;
    acquired = result.leaseActive;
    if (acquired) startHeartbeat();
    return acquired;
  }

  async function heartbeat() {
    if (!acquired) return false;
    const opGeneration = generation;
    const result = await client.leaseHeartbeat({ id: leaseId });
    if (opGeneration !== generation) return false;
    acquired = result.leaseActive;
    if (!acquired) stopHeartbeat();
    return acquired;
  }

  function startHeartbeat() {
    stopHeartbeat();
    timer = setInterval(() => {
      void heartbeat().catch(() => {
        acquired = false;
        stopHeartbeat();
      });
    }, heartbeatIntervalMs);
    timer.unref?.();
  }

  function stopHeartbeat() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  return {
    leaseId,
    get leaseAcquired() {
      return acquired;
    },
    acquire,
    heartbeat,
    async release() {
      generation += 1;
      acquired = false;
      stopHeartbeat();
      try {
        const result = await client.leaseRelease(leaseId);
        return { released: result.changed, running: true, activeLeases: result.activeLeases };
      } catch (error) {
        if (error instanceof OpenPetsClientError && error.code === "not-running") {
          return { released: false, running: false, activeLeases: 0 };
        }
        return { released: false, running: true, activeLeases: 0 };
      }
    },
  };
}

export async function openPetsStartTool(client: OpenPetsToolClient, launcher: DesktopLauncher = launchOpenPetsDesktop, leaseManager: OpenPetsLeaseManager = createMcpLeaseManager(client)): Promise<CallToolResult> {
  const existing = await readHealth(client);
  if (existing.running) {
    const lease = await acquireLeaseIfSupported(existing, leaseManager);
    if (existing.ready) return jsonResult({ running: true, ready: true, started: false, activePet: existing.activePet, lease });
  }

  if (!existing.running) {
    try {
      await launcher();
    } catch {
      return toolError("OpenPets desktop could not be started.");
    }
  }

  const deadline = Date.now() + 7000;
  let lease = existing.running ? leaseManager.leaseAcquired : false;
  while (Date.now() < deadline) {
    await sleep(200);
    const health = await readHealth(client);
    if (health.running && !lease) lease = await acquireLeaseIfSupported(health, leaseManager);
    if (health.running && health.ready) return jsonResult({ running: true, ready: true, started: !existing.running, activePet: health.activePet, lease });
  }

  return toolError("OpenPets desktop did not become ready in time.");
}

export async function openPetsReleaseTool(leaseManager: OpenPetsLeaseManager): Promise<CallToolResult> {
  return jsonResult(await leaseManager.release());
}

export async function openPetsSayTool(client: OpenPetsToolClient, limiter: SpeechLimiter, state: SayState, message: unknown, leaseManager?: OpenPetsLeaseManager): Promise<CallToolResult> {
  const validation = validateSpeechMessage(message);
  if (!validation.ok) return toolError("Speech message was rejected by safety policy.");
  if (!limiter.allow(validation.message)) return jsonResult({ sent: false, reason: "rate-limited" });

  try {
    await leaseManager?.heartbeat().catch(() => false);
    const result = await client.sendEvent({
      state,
      source: "mcp",
      type: "mcp.say",
      message: validation.message,
      timestamp: Date.now(),
    });
    return jsonResult({ sent: true, state: result.state });
  } catch {
    return toolError("OpenPets speech update failed.");
  }
}

export async function openPetsHealthTool(client: OpenPetsToolClient): Promise<CallToolResult> {
  const health = await readHealth(client);
  if (health.running) return jsonResult({ running: true, activePet: health.activePet });
  if (health.notRunning) return jsonResult({ running: false, activePet: null });
  return toolError("OpenPets health check failed.");
}

async function readHealth(client: OpenPetsToolClient): Promise<{ running: true; ready: boolean; activePet: string | null; capabilities: string[]; activeLeases: number; managed: boolean } | { running: false; notRunning: true } | { running: false; notRunning: false }> {
  try {
    const health = await client.getHealth({ timeoutMs: 500 });
    return { running: true, ready: health.ready, activePet: health.activePet, capabilities: health.capabilities, activeLeases: health.activeLeases, managed: health.managed };
  } catch (error) {
    if (error instanceof OpenPetsClientError && error.code === "not-running") {
      return { running: false, notRunning: true };
    }
    return { running: false, notRunning: false };
  }
}

async function acquireLeaseIfSupported(health: Awaited<ReturnType<typeof readHealth>>, leaseManager: OpenPetsLeaseManager) {
  if (!health.running || !health.capabilities.includes("lease-v1")) return false;
  if (leaseManager.leaseAcquired) return true;
  try {
    return await leaseManager.acquire();
  } catch {
    return false;
  }
}

export async function openPetsSetStateTool(client: OpenPetsToolClient, state: unknown, leaseManager?: OpenPetsLeaseManager): Promise<CallToolResult> {
  if (!isOpenPetsState(state)) return toolError("Invalid OpenPets state.");
  try {
    await leaseManager?.heartbeat().catch(() => false);
    const result = await client.sendEvent({
      state,
      source: "mcp",
      type: `mcp.state.${state}`,
    });
    return jsonResult({ state: result.state });
  } catch {
    return toolError("OpenPets state update failed.");
  }
}

function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function toolError(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
