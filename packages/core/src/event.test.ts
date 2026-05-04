import { describe, expect, test } from "bun:test";
import { createManualEvent, validateOpenPetsEvent } from "./event";

describe("event contract", () => {
  test("validates minimal events", () => {
    const result = validateOpenPetsEvent({ type: "state.thinking", state: "thinking" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.state).toBe("thinking");
    }
  });

  test("rejects invalid states", () => {
    const result = validateOpenPetsEvent({ type: "state.nope", state: "nope" });
    expect(result.ok).toBe(false);
  });

  test("strips unknown fields and preserves allowed metadata", () => {
    const result = validateOpenPetsEvent({
      type: "tool.started",
      state: "running",
      source: "opencode",
      message: "Running command",
      cwd: "/secret",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect("cwd" in result.event).toBe(false);
      expect(result.event.source).toBe("opencode");
    }
  });

  test("creates CLI events with defaults", () => {
    const event = createManualEvent("testing");
    expect(event.type).toBe("state.testing");
    expect(event.source).toBe("cli");
  });
});
