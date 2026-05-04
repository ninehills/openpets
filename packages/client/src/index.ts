export type {
  OpenPetsClient,
  OpenPetsClientOptions,
  OpenPetsHealth,
  OpenPetsSafeResult,
} from "./client.js";
export {
  createOpenPetsClient,
  getHealth,
  isOpenPetsRunning,
  safeSendEvent,
  sendEvent,
  windowAction,
} from "./client.js";
export type { OpenPetsEventInput } from "./event-input.js";
export { OpenPetsClientError } from "./errors.js";
export type { OpenPetsClientErrorCode } from "./errors.js";
export type { OpenPetsEvent, OpenPetsState } from "@openpets/core";
export type { OpenPetsWindowAction } from "@openpets/core/ipc";
export { createManualEvent, isOpenPetsState, validateOpenPetsEvent } from "@openpets/core";
