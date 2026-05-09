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

export const openPetsStateGuidance = {
  idle: "available, no active task",
  thinking: "planning or deciding",
  working: "general active work",
  editing: "changing files",
  running: "running commands or builds",
  testing: "running tests or checks",
  waiting: "blocked or awaiting external input",
  waving: "friendly acknowledgement; use sparingly",
  success: "task complete",
  error: "failed or blocked",
  warning: "partial success or user attention needed",
  celebrating: "notable success; use sparingly",
  sleeping: "intentionally inactive",
} as const satisfies Record<OpenPetsState, string>;

const privacyGuidance = "Do not quote or paraphrase user-provided or sensitive content. Do not include user text, code, file paths, shell commands, command output, logs, diffs, URLs, secrets, tokens, exact error messages, or private data.";
const finalStatusGuidance = "Before a final response, prefer openpets_set_state with success, error, or warning; use speech only if a short generic bubble helps.";
const sayStateGuidance = sayStates.map((state) => `${state}=${openPetsStateGuidance[state]}`).join("; ");
const allStateGuidance = openPetsStates.map((state) => `${state}=${openPetsStateGuidance[state]}`).join("; ");

export const openPetsToolDescriptions = {
  health: "Check whether the OpenPets desktop pet is reachable locally. Use when availability is unknown; if running is false, call openpets_start before speech or state tools. This is a safe read-only check.",
  start: "Launch the local OpenPets desktop pet if needed. Use before openpets_say or openpets_set_state when health says running is false, health fails, or availability is unknown. Safe to call more than once; when supported, it acquires and maintains this MCP session's lease.",
  release: "Release this MCP session's use of the desktop pet. Use at the end of a long session, when the user asks to stop using the pet, or before exit if practical. This does not globally quit OpenPets and will not close a pet used by another session.",
  say: `Send a short, generic, safe progress message to the OpenPets desktop pet. ${privacyGuidance} Use occasionally during multi-step work when speech helps; prefer openpets_set_state for frequent or silent status changes. ${finalStatusGuidance} Keep it under 100 characters and one sentence. Good examples: "Checking the next step.", "Tests are running.", "I’m ready with the result." State meanings: ${sayStateGuidance}.`,
  setState: `Set the OpenPets desktop pet status without speech. Use for silent or frequent state transitions where speech would be noisy. ${finalStatusGuidance} State meanings: ${allStateGuidance}.`,
} as const;

export const openPetsFieldDescriptions = {
  sayState: `Display state for the speech bubble. Allowed speech states: ${sayStateGuidance}.`,
  sayMessage: `Short generic one-sentence progress message under 100 characters. ${privacyGuidance}`,
  setState: `OpenPets animation state without speech. All states: ${allStateGuidance}.`,
} as const;

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
      description: openPetsToolDescriptions.health,
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => openPetsHealthTool(client),
  );

  server.registerTool(
    "openpets_start",
    {
      description: openPetsToolDescriptions.start,
      inputSchema: z.object({}),
      annotations: { idempotentHint: true },
    },
    async () => openPetsStartTool(client, launcher, leaseManager),
  );

  server.registerTool(
    "openpets_release",
    {
      description: openPetsToolDescriptions.release,
      inputSchema: z.object({}),
      annotations: { idempotentHint: true },
    },
    async () => openPetsReleaseTool(leaseManager),
  );

  server.registerTool(
    "openpets_say",
    {
      description: openPetsToolDescriptions.say,
      inputSchema: z.object({
        state: z.enum(sayStates).describe(openPetsFieldDescriptions.sayState),
        message: z.string().describe(openPetsFieldDescriptions.sayMessage),
      }),
    },
    async ({ state, message }) => openPetsSayTool(client, limiter, state, message, leaseManager),
  );

  server.registerTool(
    "openpets_set_state",
    {
      description: openPetsToolDescriptions.setState,
      inputSchema: z.object({
        state: z.enum(openPetsStates).describe(openPetsFieldDescriptions.setState),
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
    await ensureLeaseForEvent(leaseManager);
    const result = await client.sendEvent({
      state,
      source: leaseManager?.leaseId ?? "mcp",
      ...(leaseManager?.leaseAcquired ? { leaseId: leaseManager.leaseId } : {}),
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
    await ensureLeaseForEvent(leaseManager);
    const result = await client.sendEvent({
      state,
      source: leaseManager?.leaseId ?? "mcp",
      ...(leaseManager?.leaseAcquired ? { leaseId: leaseManager.leaseId } : {}),
      type: `mcp.state.${state}`,
    });
    return jsonResult({ state: result.state });
  } catch {
    return toolError("OpenPets state update failed.");
  }
}

async function ensureLeaseForEvent(leaseManager: OpenPetsLeaseManager | undefined) {
  if (!leaseManager) return false;
  if (leaseManager.leaseAcquired) return leaseManager.heartbeat().catch(() => false);
  return leaseManager.acquire().catch(() => false);
}

function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function toolError(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
