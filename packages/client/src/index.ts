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
  selectPet,
  sendEvent,
  windowAction,
} from "./client.js";
export type { OpenPetsEventInput } from "./event-input.js";
export { OpenPetsClientError } from "./errors.js";
export type { OpenPetsClientErrorCode } from "./errors.js";
export type { LeaseResult, OpenPetsEvent, OpenPetsLeaseClient, OpenPetsState } from "@open-pets/core";
export type { OpenPetsWindowAction } from "@open-pets/core/ipc";
export { createManualEvent, isOpenPetsState, validateOpenPetsEvent } from "@open-pets/core";
