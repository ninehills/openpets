import type { OpenPetsState } from "./states.js";

export type CodexStateId =
  | "idle"
  | "running-right"
  | "running-left"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review";

export type CodexState = {
  id: CodexStateId;
  row: number;
  frames: number;
  durationMs: number;
};

export const CODEX_FRAME_WIDTH = 192;
export const CODEX_FRAME_HEIGHT = 208;
export const CODEX_COLUMNS = 8;
export const CODEX_ROWS = 9;
export const CODEX_SPRITESHEET_WIDTH = 1536;
export const CODEX_SPRITESHEET_HEIGHT = 1872;

export const codexStates = [
  { id: "idle", row: 0, frames: 6, durationMs: 1100 },
  { id: "running-right", row: 1, frames: 8, durationMs: 1060 },
  { id: "running-left", row: 2, frames: 8, durationMs: 1060 },
  { id: "waving", row: 3, frames: 4, durationMs: 700 },
  { id: "jumping", row: 4, frames: 5, durationMs: 840 },
  { id: "failed", row: 5, frames: 8, durationMs: 1220 },
  { id: "waiting", row: 6, frames: 6, durationMs: 1010 },
  { id: "running", row: 7, frames: 6, durationMs: 820 },
  { id: "review", row: 8, frames: 6, durationMs: 1030 },
] as const satisfies readonly CodexState[];

export const openPetsToCodexState = {
  idle: "idle",
  thinking: "review",
  working: "running",
  editing: "running",
  running: "running",
  testing: "waiting",
  waiting: "waiting",
  waving: "waving",
  success: "jumping",
  error: "failed",
  warning: "failed",
  celebrating: "jumping",
  sleeping: "idle",
} as const satisfies Record<OpenPetsState, CodexStateId>;

export function getCodexStateForOpenPetsState(state: OpenPetsState): CodexState {
  const codexId = openPetsToCodexState[state];
  const codexState = codexStates.find((item) => item.id === codexId);
  if (!codexState) {
    throw new Error(`Missing Codex mapping for ${state}`);
  }
  return codexState;
}
