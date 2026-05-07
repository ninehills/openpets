import { describe, expect, test } from "bun:test";
import { createOnboardingState, shouldOpenOnboarding, type OpenPetsConfig } from "./config.js";

describe("shouldOpenOnboarding", () => {
  test("does not auto-open in development", () => {
    expect(shouldOpenOnboarding({}, { packaged: false })).toBe(false);
  });

  test("opens for first packaged interactive launch", () => {
    expect(shouldOpenOnboarding({}, { packaged: true, mode: "interactive" })).toBe(true);
  });

  test("does not auto-open for agent-launched packaged sessions", () => {
    expect(shouldOpenOnboarding({}, { packaged: true, mode: "agent" })).toBe(false);
  });

  test("does not open after user skips", () => {
    const config: OpenPetsConfig = { onboarding: { status: "skipped", version: 1, skippedAt: "2026-01-01T00:00:00.000Z" } };
    expect(shouldOpenOnboarding(config, { packaged: true })).toBe(false);
  });

  test("does not open for current completed version", () => {
    const config: OpenPetsConfig = { onboarding: { status: "completed", version: 1, completedAt: "2026-01-01T00:00:00.000Z" } };
    expect(shouldOpenOnboarding(config, { packaged: true, currentVersion: 1 })).toBe(false);
  });

  test("opens when completed onboarding is outdated", () => {
    const config: OpenPetsConfig = { onboarding: { status: "completed", version: 1, completedAt: "2026-01-01T00:00:00.000Z" } };
    expect(shouldOpenOnboarding(config, { packaged: true, currentVersion: 2 })).toBe(true);
  });

  test("forced launch bypasses environment and status checks", () => {
    const config: OpenPetsConfig = { onboarding: { status: "skipped", version: 1, skippedAt: "2026-01-01T00:00:00.000Z" } };
    expect(shouldOpenOnboarding(config, { packaged: false, forced: true, mode: "agent" })).toBe(true);
  });
});

describe("createOnboardingState", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  test("creates completed state with timestamp", () => {
    expect(createOnboardingState("completed", now)).toEqual({
      status: "completed",
      version: 1,
      completedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  test("creates skipped state with timestamp", () => {
    expect(createOnboardingState("skipped", now)).toEqual({
      status: "skipped",
      version: 1,
      skippedAt: "2026-01-01T00:00:00.000Z",
    });
  });
});
