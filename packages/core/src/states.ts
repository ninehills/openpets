export const openPetsStates = [
  "idle",
  "thinking",
  "working",
  "editing",
  "running",
  "testing",
  "waiting",
  "waving",
  "success",
  "error",
  "warning",
  "celebrating",
  "sleeping",
] as const;

export type OpenPetsState = (typeof openPetsStates)[number];

export const longRunningStates = [
  "idle",
  "thinking",
  "working",
  "editing",
  "running",
  "testing",
  "waiting",
  "waving",
  "sleeping",
] as const satisfies readonly OpenPetsState[];

export const temporaryStates = [
  "success",
  "error",
  "warning",
  "celebrating",
] as const satisfies readonly OpenPetsState[];

export const statePriority = [
  "error",
  "warning",
  "celebrating",
  "success",
  "waving",
  "waiting",
  "testing",
  "editing",
  "running",
  "working",
  "thinking",
  "idle",
  "sleeping",
] as const satisfies readonly OpenPetsState[];

const stateSet = new Set<string>(openPetsStates);
const temporarySet = new Set<string>(temporaryStates);
const longRunningSet = new Set<string>(longRunningStates);
const priorityMap = new Map<OpenPetsState, number>(
  statePriority.map((state, index) => [state, statePriority.length - index]),
);

export function isOpenPetsState(value: unknown): value is OpenPetsState {
  return typeof value === "string" && stateSet.has(value);
}

export function isTemporaryState(state: OpenPetsState) {
  return temporarySet.has(state);
}

export function isLongRunningState(state: OpenPetsState) {
  return longRunningSet.has(state);
}

export function getStatePriority(state: OpenPetsState) {
  return priorityMap.get(state) ?? 0;
}
