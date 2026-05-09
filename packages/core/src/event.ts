import { isOpenPetsState, type OpenPetsState } from "./states.js";

export const MAX_EVENT_BODY_BYTES = 16 * 1024;
export const MAX_TYPE_LENGTH = 80;
export const MAX_SOURCE_LENGTH = 80;
export const MAX_MESSAGE_LENGTH = 240;
export const MAX_TOOL_LENGTH = 80;
export const MAX_EVENT_LEASE_ID_LENGTH = 120;

export type ParsedOpenPetsSource = {
  agentType: string;
  detail: string;
};

export type OpenPetsEvent = {
  type: string;
  state: OpenPetsState;
  source?: string;
  leaseId?: string;
  message?: string;
  tool?: string;
  timestamp?: number;
};

export function parseSource(source = "default"): ParsedOpenPetsSource {
  const trimmed = source.trim() || "default";
  const separator = trimmed.indexOf(":");
  if (separator < 0) return { agentType: trimmed, detail: "" };
  return {
    agentType: trimmed.slice(0, separator).trim() || "default",
    detail: trimmed.slice(separator + 1).trim(),
  };
}

export type EventValidationResult =
  | { ok: true; event: OpenPetsEvent }
  | { ok: false; error: string };

function optionalString(
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined | { error: string } {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    return { error: `${field} must be a string` };
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    return { error: `${field} must be ${maxLength} chars or less` };
  }

  return trimmed;
}

export function validateOpenPetsEvent(input: unknown): EventValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Event must be a JSON object" };
  }

  const record = input as Record<string, unknown>;

  if (typeof record.type !== "string" || record.type.trim().length === 0) {
    return { ok: false, error: "type must be a non-empty string" };
  }

  const type = record.type.trim();
  if (type.length > MAX_TYPE_LENGTH) {
    return { ok: false, error: `type must be ${MAX_TYPE_LENGTH} chars or less` };
  }

  if (!isOpenPetsState(record.state)) {
    return { ok: false, error: "Invalid event state" };
  }

  const source = optionalString(record.source, "source", MAX_SOURCE_LENGTH);
  if (typeof source === "object") return { ok: false, error: source.error };

  const leaseId = optionalString(record.leaseId, "leaseId", MAX_EVENT_LEASE_ID_LENGTH);
  if (typeof leaseId === "object") return { ok: false, error: leaseId.error };

  const message = optionalString(record.message, "message", MAX_MESSAGE_LENGTH);
  if (typeof message === "object") return { ok: false, error: message.error };

  const tool = optionalString(record.tool, "tool", MAX_TOOL_LENGTH);
  if (typeof tool === "object") return { ok: false, error: tool.error };

  let timestamp: number | undefined;
  if (record.timestamp !== undefined) {
    if (typeof record.timestamp !== "number" || !Number.isFinite(record.timestamp)) {
      return { ok: false, error: "timestamp must be a finite number" };
    }
    timestamp = record.timestamp;
  }

  return {
    ok: true,
    event: {
      type,
      state: record.state,
      ...(source ? { source } : {}),
      ...(leaseId ? { leaseId } : {}),
      ...(message ? { message } : {}),
      ...(tool ? { tool } : {}),
      ...(timestamp === undefined ? {} : { timestamp }),
    },
  };
}

export function createManualEvent(
  state: OpenPetsState,
  options: Omit<Partial<OpenPetsEvent>, "state"> = {},
): OpenPetsEvent {
  return {
    type: options.type ?? `state.${state}`,
    state,
    source: options.source ?? "cli",
    ...(options.leaseId ? { leaseId: options.leaseId } : {}),
    ...(options.message ? { message: options.message } : {}),
    ...(options.tool ? { tool: options.tool } : {}),
    timestamp: options.timestamp ?? Date.now(),
  };
}
