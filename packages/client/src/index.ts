export type {
  OpenPetsClient,
  OpenPetsClientOptions,
  OpenPetsHealth,
  OpenPetsLeaseInput,
  OpenPetsSafeResult,
} from "./client.js";
export {
  createOpenPetsClient,
  getHealth,
  isOpenPetsRunning,
  leaseAcquire,
  leaseHeartbeat,
  leaseRelease,
  safeSendEvent,
  sendEvent,
  windowAction,
} from "./client.js";
export type { OpenPetsEventInput } from "./event-input.js";
export { OpenPetsClientError } from "./errors.js";
export type { OpenPetsClientErrorCode } from "./errors.js";
export type { LeaseResult, OpenPetsEvent, OpenPetsLeaseClient, OpenPetsState } from "@openpets/core";
export type { OpenPetsWindowAction } from "@openpets/core/ipc";
export { createManualEvent, isOpenPetsState, validateOpenPetsEvent } from "@openpets/core";
