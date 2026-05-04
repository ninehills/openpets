import { describe, expect, test } from "bun:test";
import { createSpeechLimiter, validateSpeechMessage } from "./safety.js";

describe("speech safety", () => {
  test("accepts short general progress messages", () => {
    expect(validateSpeechMessage("I’m mapping the moving parts.")).toEqual({ ok: true, message: "I’m mapping the moving parts." });
    expect(validateSpeechMessage("Running a quick check.")).toEqual({ ok: true, message: "Running a quick check." });
  });

  test("rejects paths commands urls secrets and logs", () => {
    expect(validateSpeechMessage("I’m editing src/auth/session.ts.").ok).toBe(false);
    expect(validateSpeechMessage("Running npm test -- --token abc123.").ok).toBe(false);
    expect(validateSpeechMessage("Running docker build now.").ok).toBe(false);
    expect(validateSpeechMessage("Trying pytest again.").ok).toBe(false);
    expect(validateSpeechMessage("Running cargo test locally.").ok).toBe(false);
    expect(validateSpeechMessage("Error: Cannot read properties of undefined.").ok).toBe(false);
    expect(validateSpeechMessage("TypeError: bad thing happened.").ok).toBe(false);
    expect(validateSpeechMessage("Check https://example.com").ok).toBe(false);
    expect(validateSpeechMessage("Token abcdefghijklmnopqrstuvwxyz123456").ok).toBe(false);
  });

  test("rejects multiline markdown and too long messages", () => {
    expect(validateSpeechMessage("hello\nworld").ok).toBe(false);
    expect(validateSpeechMessage("```code```").ok).toBe(false);
    expect(validateSpeechMessage("x".repeat(101)).ok).toBe(false);
  });

  test("rate limits and dedupes speech", () => {
    const limiter = createSpeechLimiter({ minIntervalMs: 1000, duplicateWindowMs: 10000 });
    expect(limiter.allow("That worked.", 1000)).toBe(true);
    expect(limiter.allow("Another update.", 1500)).toBe(false);
    expect(limiter.allow("That worked.", 2500)).toBe(false);
    expect(limiter.allow("Another update.", 2500)).toBe(true);
  });
});
