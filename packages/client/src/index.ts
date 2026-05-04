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
} from "./client.js";
export type { OpenPetsEventInput } from "./event-input.js";
export { OpenPetsClientError } from "./errors.js";
export type { OpenPetsClientErrorCode } from "./errors.js";
export type { OpenPetsEvent, OpenPetsState } from "@openpets/core";
export { createManualEvent, isOpenPetsState, validateOpenPetsEvent } from "@openpets/core";
