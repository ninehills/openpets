import { describe, expect, test } from "bun:test";
import { createManualEvent, parseSource, validateOpenPetsEvent } from "./event";

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

  test("preserves lease ids for multi-pet routing", () => {
    const result = validateOpenPetsEvent({ type: "state.working", state: "working", leaseId: "mcp:123" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.event.leaseId).toBe("mcp:123");
  });

  test("parses structured sources", () => {
    expect(parseSource("pi:openpets")).toEqual({ agentType: "pi", detail: "openpets" });
    expect(parseSource("mcp")).toEqual({ agentType: "mcp", detail: "" });
  });

  test("creates CLI events with defaults", () => {
    const event = createManualEvent("testing", { leaseId: "cli:one" });
    expect(event.type).toBe("state.testing");
    expect(event.source).toBe("cli");
    expect(event.leaseId).toBe("cli:one");
  });
});
