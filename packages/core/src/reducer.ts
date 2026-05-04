import type { OpenPetsEvent } from "./event.js";
import {
  getStatePriority,
  isLongRunningState,
  isTemporaryState,
  type OpenPetsState,
} from "./states.js";

export const reducerTimings = {
  duplicateDebounceMs: 250,
  successDurationMs: 1800,
  errorDurationMs: 2400,
  warningDurationMs: 2200,
  celebratingDurationMs: 2200,
} as const;

export type ReducerClock = {
  now: number;
};

export type PetRuntimeState = {
  rendered: OpenPetsState;
  fallback: OpenPetsState;
  lastAcceptedState: OpenPetsState;
  lastAcceptedAt: number;
  temporaryUntil: number | null;
  event?: OpenPetsEvent;
};

export function createInitialPetRuntimeState(now = Date.now()): PetRuntimeState {
  return {
    rendered: "idle",
    fallback: "idle",
    lastAcceptedState: "idle",
    lastAcceptedAt: now,
    temporaryUntil: null,
  };
}

function temporaryDuration(state: OpenPetsState): number | null {
  switch (state) {
    case "success":
      return reducerTimings.successDurationMs;
    case "error":
      return reducerTimings.errorDurationMs;
    case "warning":
      return reducerTimings.warningDurationMs;
    case "celebrating":
      return reducerTimings.celebratingDurationMs;
    default:
      return null;
  }
}

function expireTemporary(state: PetRuntimeState, now: number): PetRuntimeState {
  if (state.temporaryUntil !== null && now >= state.temporaryUntil) {
    return {
      ...state,
      rendered: state.fallback,
      temporaryUntil: null,
    };
  }
  return state;
}

export function reducePetEvent(
  current: PetRuntimeState,
  event: OpenPetsEvent,
  clock: ReducerClock = { now: Date.now() },
): PetRuntimeState {
  const now = clock.now;
  const state = expireTemporary(current, now);

  if (
    event.state === state.lastAcceptedState &&
    now - state.lastAcceptedAt < reducerTimings.duplicateDebounceMs
  ) {
    return state;
  }

  const acceptedBase = {
    ...state,
    lastAcceptedState: event.state,
    lastAcceptedAt: now,
    event,
  } satisfies PetRuntimeState;

  const duration = temporaryDuration(event.state);
  if (duration !== null) {
    if (
      state.temporaryUntil !== null &&
      isTemporaryState(state.rendered) &&
      getStatePriority(event.state) < getStatePriority(state.rendered)
    ) {
      return acceptedBase;
    }

    return {
      ...acceptedBase,
      rendered: event.state,
      temporaryUntil: now + duration,
    };
  }

  if (!isLongRunningState(event.state)) {
    return acceptedBase;
  }

  if (state.temporaryUntil !== null && isTemporaryState(state.rendered)) {
    return {
      ...acceptedBase,
      fallback: event.state,
    };
  }

  return {
    ...acceptedBase,
    rendered: event.state,
    fallback: event.state,
    temporaryUntil: null,
  };
}

export function tickPetState(
  current: PetRuntimeState,
  clock: ReducerClock = { now: Date.now() },
) {
  return expireTemporary(current, clock.now);
}
