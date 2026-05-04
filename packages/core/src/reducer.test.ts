import { describe, expect, test } from "bun:test";
import { createManualEvent } from "./event";
import { createInitialPetRuntimeState, reducePetEvent, tickPetState } from "./reducer";

describe("pet state reducer", () => {
  test("long-running states render immediately", () => {
    let state = createInitialPetRuntimeState(0);
    state = reducePetEvent(state, createManualEvent("thinking"), { now: 1000 });
    expect(state.rendered).toBe("thinking");

    state = reducePetEvent(state, createManualEvent("testing"), { now: 2000 });
    expect(state.rendered).toBe("testing");
  });

  test("duplicate events are ignored briefly", () => {
    let state = createInitialPetRuntimeState(0);
    state = reducePetEvent(state, createManualEvent("thinking", { message: "a" }), {
      now: 1000,
    });
    const duplicate = reducePetEvent(
      state,
      createManualEvent("thinking", { message: "b" }),
      { now: 1100 },
    );

    expect(duplicate.event?.message).toBe("a");
  });

  test("temporary states hold then return to fallback", () => {
    let state = createInitialPetRuntimeState(0);
    state = reducePetEvent(state, createManualEvent("testing"), { now: 1000 });
    state = reducePetEvent(state, createManualEvent("success"), { now: 1100 });
    expect(state.rendered).toBe("success");

    state = reducePetEvent(state, createManualEvent("working"), { now: 1200 });
    expect(state.rendered).toBe("success");
    expect(state.fallback).toBe("working");

    state = tickPetState(state, { now: 3000 });
    expect(state.rendered).toBe("working");
  });

  test("higher-priority temporary states override lower-priority temporary states", () => {
    let state = createInitialPetRuntimeState(0);
    state = reducePetEvent(state, createManualEvent("success"), { now: 1000 });
    state = reducePetEvent(state, createManualEvent("error"), { now: 1100 });

    expect(state.rendered).toBe("error");
  });

  test("lower-priority temporary states do not override higher-priority temporary states", () => {
    let state = createInitialPetRuntimeState(0);
    state = reducePetEvent(state, createManualEvent("error"), { now: 1000 });
    state = reducePetEvent(state, createManualEvent("success"), { now: 1100 });

    expect(state.rendered).toBe("error");
  });
});
