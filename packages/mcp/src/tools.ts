import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createOpenPetsClient, OpenPetsClientError, type OpenPetsClient } from "@openpets/client";
import { isOpenPetsState, openPetsStates, type OpenPetsState } from "@openpets/core";
import * as z from "zod/v4";
import { launchOpenPetsDesktop, sleep, type DesktopLauncher } from "./launcher.js";
import { createSpeechLimiter, validateSpeechMessage, type SpeechLimiter } from "./safety.js";

export type OpenPetsToolClient = Pick<OpenPetsClient, "getHealth" | "sendEvent">;

const sayStates = ["thinking", "working", "editing", "running", "testing", "waiting", "success", "error"] as const satisfies readonly OpenPetsState[];
type SayState = (typeof sayStates)[number];

export function registerOpenPetsTools(
  server: McpServer,
  client: OpenPetsToolClient = createOpenPetsClient(),
  limiter: SpeechLimiter = createSpeechLimiter(),
  launcher: DesktopLauncher = launchOpenPetsDesktop,
) {
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
    async () => openPetsStartTool(client, launcher),
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
    async ({ state, message }) => openPetsSayTool(client, limiter, state, message),
  );

  server.registerTool(
    "openpets_set_state",
    {
      description: "Set the OpenPets desktop pet status without speech.",
      inputSchema: z.object({
        state: z.enum(openPetsStates).describe("OpenPets state."),
      }),
    },
    async ({ state }) => openPetsSetStateTool(client, state),
  );
}

export async function openPetsStartTool(client: OpenPetsToolClient, launcher: DesktopLauncher = launchOpenPetsDesktop): Promise<CallToolResult> {
  const existing = await readHealth(client);
  if (existing.running && existing.ready) return jsonResult({ running: true, ready: true, started: false, activePet: existing.activePet });

  try {
    await launcher();
  } catch {
    return toolError("OpenPets desktop could not be started.");
  }

  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    await sleep(200);
    const health = await readHealth(client);
    if (health.running && health.ready) return jsonResult({ running: true, ready: true, started: true, activePet: health.activePet });
  }

  return toolError("OpenPets desktop did not become ready in time.");
}

export async function openPetsSayTool(client: OpenPetsToolClient, limiter: SpeechLimiter, state: SayState, message: unknown): Promise<CallToolResult> {
  const validation = validateSpeechMessage(message);
  if (!validation.ok) return toolError("Speech message was rejected by safety policy.");
  if (!limiter.allow(validation.message)) return jsonResult({ sent: false, reason: "rate-limited" });

  try {
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

async function readHealth(client: OpenPetsToolClient): Promise<{ running: true; ready: boolean; activePet: string | null } | { running: false; notRunning: true } | { running: false; notRunning: false }> {
  try {
    const health = await client.getHealth({ timeoutMs: 500 });
    return { running: true, ready: health.ready, activePet: health.activePet };
  } catch (error) {
    if (error instanceof OpenPetsClientError && error.code === "not-running") {
      return { running: false, notRunning: true };
    }
    return { running: false, notRunning: false };
  }
}

export async function openPetsSetStateTool(client: OpenPetsToolClient, state: unknown): Promise<CallToolResult> {
  if (!isOpenPetsState(state)) return toolError("Invalid OpenPets state.");
  try {
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
