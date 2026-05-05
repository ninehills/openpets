import {
  createManualEvent,
  isOpenPetsState,
  validateOpenPetsEvent,
  type OpenPetsEvent,
  type OpenPetsState,
} from "@open-pets/core";
import { OpenPetsClientError } from "./errors.js";

export type OpenPetsEventInput =
  | OpenPetsEvent
  | {
      state: OpenPetsState;
      source?: string;
      type?: string;
      message?: string;
      tool?: string;
    };

export function normalizeEventInput(input: OpenPetsEventInput): OpenPetsEvent {
  const existing = validateOpenPetsEvent(input);
  if (existing.ok) return existing.event;

  if (!input || typeof input !== "object" || Array.isArray(input) || !isOpenPetsState(input.state)) {
    throw new OpenPetsClientError("rejected", existing.error);
  }

  const event = createManualEvent(input.state, {
    source: input.source ?? "client",
    type: input.type ?? `state.${input.state}`,
    ...(input.message ? { message: input.message } : {}),
    ...(input.tool ? { tool: input.tool } : {}),
  });
  const validation = validateOpenPetsEvent(event);
  if (!validation.ok) throw new OpenPetsClientError("rejected", validation.error);
  return validation.event;
}
