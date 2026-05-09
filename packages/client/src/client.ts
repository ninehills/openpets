import { createConnection } from "node:net";
import { isOpenPetsState, type LeaseParams, type LeaseResult, type OpenPetsEvent, type OpenPetsLeaseClient, type OpenPetsState } from "@open-pets/core";
import {
  getDefaultOpenPetsIpcEndpoint,
  isOpenPetsWindowAction,
  MAX_IPC_FRAME_BYTES,
  OPENPETS_IPC_PROTOCOL_VERSION,
  parseIpcFrame,
  serializeIpcRequest,
  type IpcErrorCode,
  type IpcResponse,
  type OpenPetsHealthV2,
  type OpenPetsWindowAction,
  type SelectPetParams,
} from "@open-pets/core/ipc";
import { OpenPetsClientError } from "./errors.js";
import { normalizeEventInput, type OpenPetsEventInput } from "./event-input.js";

export type OpenPetsClientOptions = {
  endpoint?: string;
  timeoutMs?: number;
  verifyOpenPets?: boolean;
};

export type OpenPetsHealth = OpenPetsHealthV2;

export type OpenPetsSafeResult =
  | { ok: true; state?: OpenPetsState }
  | { ok: false; error: OpenPetsClientError };

export type OpenPetsLeaseInput = {
  id: string;
  client: OpenPetsLeaseClient;
  label?: string;
  ttlMs?: number;
  autoClose?: boolean;
};

export type OpenPetsClient = {
  getHealth(options?: OpenPetsClientOptions): Promise<OpenPetsHealth>;
  isRunning(options?: OpenPetsClientOptions): Promise<boolean>;
  sendEvent(event: OpenPetsEventInput, options?: OpenPetsClientOptions): Promise<{ ok: true; state: OpenPetsState }>;
  safeSendEvent(event: OpenPetsEventInput, options?: OpenPetsClientOptions): Promise<OpenPetsSafeResult>;
  windowAction(action: OpenPetsWindowAction, options?: OpenPetsClientOptions): Promise<{ ok: true; action: OpenPetsWindowAction }>;
  selectPet(path: string, options?: OpenPetsClientOptions): Promise<{ ok: true; pet: { id: string; displayName: string; directory: string } }>;
  leaseAcquire(input: OpenPetsLeaseInput, options?: OpenPetsClientOptions): Promise<LeaseResult>;
  leaseHeartbeat(input: { id: string; ttlMs?: number }, options?: OpenPetsClientOptions): Promise<LeaseResult>;
  leaseRelease(id: string, options?: OpenPetsClientOptions): Promise<LeaseResult>;
};

type ResolvedOptions = {
  endpoint: string;
  timeoutMs: number | undefined;
  verifyOpenPets: boolean;
};

export function createOpenPetsClient(options: OpenPetsClientOptions = {}): OpenPetsClient {
  let verifiedEndpoint: string | null = null;

  function mergedOptions(overrides: OpenPetsClientOptions = {}): ResolvedOptions {
    return {
      endpoint: overrides.endpoint ?? options.endpoint ?? getDefaultOpenPetsIpcEndpoint(),
      timeoutMs: overrides.timeoutMs ?? options.timeoutMs,
      verifyOpenPets: overrides.verifyOpenPets ?? options.verifyOpenPets ?? true,
    };
  }

  async function getHealthForClient(overrides: OpenPetsClientOptions = {}) {
    const merged = mergedOptions(overrides);
    return fetchHealth(merged.endpoint, merged.timeoutMs ?? 1000);
  }

  async function sendEventForClient(event: OpenPetsEventInput, overrides: OpenPetsClientOptions = {}) {
    const merged = mergedOptions(overrides);
    const timeoutMs = merged.timeoutMs ?? 1000;
    const deadline = Date.now() + timeoutMs;
    if (merged.verifyOpenPets && verifiedEndpoint !== merged.endpoint) {
      await fetchHealth(merged.endpoint, remainingMs(deadline));
      verifiedEndpoint = merged.endpoint;
    }
    return sendEventIpc(merged.endpoint, normalizeEventInput(event), remainingMs(deadline));
  }

  async function safeSendEventForClient(event: OpenPetsEventInput, overrides: OpenPetsClientOptions = {}) {
    try {
      return await sendEventForClient(event, { ...overrides, timeoutMs: overrides.timeoutMs ?? options.timeoutMs ?? 400 });
    } catch (error) {
      return { ok: false, error: toClientError(error) } as const;
    }
  }

  async function windowActionForClient(action: OpenPetsWindowAction, overrides: OpenPetsClientOptions = {}) {
    if (!isOpenPetsWindowAction(action)) throw new OpenPetsClientError("rejected", "Invalid OpenPets window action");
    const merged = mergedOptions(overrides);
    const response = await requestIpc(merged.endpoint, { id: createRequestId("window"), method: "window", params: { action } }, merged.timeoutMs ?? 1000);
    return validateWindowActionResult(unwrapIpcResult(response));
  }

  async function leaseRequestForClient(params: LeaseParams, overrides: OpenPetsClientOptions = {}) {
    const merged = mergedOptions(overrides);
    const response = await requestIpc(merged.endpoint, { id: createRequestId("lease"), method: "lease", params }, merged.timeoutMs ?? 1000);
    return validateLeaseResult(unwrapIpcResult(response));
  }

  async function selectPetForClient(path: string, overrides: OpenPetsClientOptions = {}) {
    const merged = mergedOptions(overrides);
    const response = await requestIpc(merged.endpoint, { id: createRequestId("pet"), method: "pet", params: { path } satisfies SelectPetParams }, merged.timeoutMs ?? 2000);
    return validateSelectPetResult(unwrapIpcResult(response));
  }

  return {
    getHealth: getHealthForClient,
    async isRunning(overrides) {
      try {
        await getHealthForClient(overrides);
        return true;
      } catch {
        return false;
      }
    },
    sendEvent: sendEventForClient,
    safeSendEvent: safeSendEventForClient,
    windowAction: windowActionForClient,
    selectPet: selectPetForClient,
    leaseAcquire(input, overrides) {
      return leaseRequestForClient({ action: "acquire", ...input }, overrides);
    },
    leaseHeartbeat(input, overrides) {
      return leaseRequestForClient({ action: "heartbeat", ...input }, overrides);
    },
    leaseRelease(id, overrides) {
      return leaseRequestForClient({ action: "release", id }, overrides);
    },
  };
}

const defaultClient = createOpenPetsClient();

export function getHealth(options?: OpenPetsClientOptions) {
  return defaultClient.getHealth(options);
}

export function isOpenPetsRunning(options?: OpenPetsClientOptions) {
  return defaultClient.isRunning(options);
}

export function sendEvent(event: OpenPetsEventInput, options?: OpenPetsClientOptions) {
  return defaultClient.sendEvent(event, options);
}

export function safeSendEvent(event: OpenPetsEventInput, options?: OpenPetsClientOptions) {
  return defaultClient.safeSendEvent(event, options);
}

export function windowAction(action: OpenPetsWindowAction, options?: OpenPetsClientOptions) {
  return defaultClient.windowAction(action, options);
}

export function selectPet(path: string, options?: OpenPetsClientOptions) {
  return defaultClient.selectPet(path, options);
}

export function leaseAcquire(input: OpenPetsLeaseInput, options?: OpenPetsClientOptions) {
  return defaultClient.leaseAcquire(input, options);
}

export function leaseHeartbeat(input: { id: string; ttlMs?: number }, options?: OpenPetsClientOptions) {
  return defaultClient.leaseHeartbeat(input, options);
}

export function leaseRelease(id: string, options?: OpenPetsClientOptions) {
  return defaultClient.leaseRelease(id, options);
}

async function fetchHealth(endpoint: string, timeoutMs: number): Promise<OpenPetsHealth> {
  const response = await requestIpc(endpoint, { id: createRequestId("health"), method: "health" }, timeoutMs);
  return validateIpcHealth(unwrapIpcResult(response));
}

async function sendEventIpc(endpoint: string, event: OpenPetsEvent, timeoutMs: number): Promise<{ ok: true; state: OpenPetsState }> {
  const response = await requestIpc(endpoint, { id: createRequestId("event"), method: "event", params: event }, timeoutMs);
  return validateEventResult(unwrapIpcResult(response));
}

function requestIpc(endpoint: string, request: { id: string; method: "health" | "event" | "window" | "lease" | "pet"; params?: unknown }, timeoutMs: number): Promise<IpcResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = Buffer.alloc(0);
    const socket = createConnection(endpoint);
    const timeout = setTimeout(() => settle(reject, new OpenPetsClientError("timeout", "OpenPets request timed out")), timeoutMs);

    socket.on("connect", () => {
      try {
        socket.write(serializeIpcRequest(request));
      } catch (error) {
        settle(reject, error);
      }
    });

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, typeof chunk === "string" ? Buffer.from(chunk) : chunk]);
      if (buffer.byteLength > MAX_IPC_FRAME_BYTES) {
        settle(reject, new OpenPetsClientError("invalid-response", "OpenPets IPC response is too large"));
        return;
      }
      const newlineIndex = buffer.indexOf(0x0a);
      if (newlineIndex < 0) return;
      try {
        settle(resolve, validateIpcResponse(parseIpcFrame(buffer.subarray(0, newlineIndex + 1)), request.id));
      } catch (error) {
        settle(reject, error);
      }
    });

    socket.on("end", () => {
      if (!settled) settle(reject, new OpenPetsClientError("invalid-response", "OpenPets IPC response ended before a complete frame"));
    });
    socket.on("close", () => {
      if (!settled) settle(reject, new OpenPetsClientError("not-running", "OpenPets is not running or cannot be reached"));
    });
    socket.on("error", (error: NodeJS.ErrnoException) => {
      settle(reject, error.code === "ENOENT" || error.code === "ECONNREFUSED"
        ? new OpenPetsClientError("not-running", "OpenPets is not running or cannot be reached", { cause: error })
        : toClientError(error));
    });

    function settle<T>(fn: (value: T) => void, value: T) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      fn(value);
    }
  });
}

function validateIpcResponse(input: unknown, expectedId: string): IpcResponse {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new OpenPetsClientError("invalid-response", "OpenPets IPC response must be an object");
  const record = input as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.ok !== "boolean") throw new OpenPetsClientError("invalid-response", "OpenPets IPC response is missing required fields");
  if (record.id !== expectedId) throw new OpenPetsClientError("invalid-response", "OpenPets IPC response id did not match request id");
  if (record.ok) return { id: record.id, ok: true, result: record.result };
  const error = record.error;
  if (!error || typeof error !== "object" || Array.isArray(error)) throw new OpenPetsClientError("invalid-response", "OpenPets IPC error response is invalid");
  const code = (error as Record<string, unknown>).code;
  const message = (error as Record<string, unknown>).message;
  return { id: record.id, ok: false, error: { code: typeof code === "string" ? code as IpcErrorCode : "internal-error", message: typeof message === "string" ? message : "OpenPets IPC request failed" } };
}

function unwrapIpcResult(response: IpcResponse) {
  if (response.ok) return response.result;
  if (response.error.code === "timeout") throw new OpenPetsClientError("timeout", response.error.message);
  if (response.error.code === "invalid-params") throw new OpenPetsClientError("rejected", response.error.message);
  throw new OpenPetsClientError("invalid-response", response.error.message);
}

function validateIpcHealth(input: unknown): OpenPetsHealthV2 {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new OpenPetsClientError("invalid-response", "OpenPets IPC health response must be an object");
  const record = input as Record<string, unknown>;
  if (record.app !== "openpets") throw new OpenPetsClientError("not-openpets", "IPC endpoint is not served by OpenPets");
  if (record.protocolVersion !== OPENPETS_IPC_PROTOCOL_VERSION || record.transport !== "ipc") throw new OpenPetsClientError("incompatible-protocol", "OpenPets IPC protocol version is not supported");
  if (record.ok !== true || typeof record.version !== "string" || typeof record.ready !== "boolean") throw new OpenPetsClientError("invalid-response", "OpenPets IPC health response is missing required fields");
  return {
    app: "openpets",
    ok: true,
    version: record.version,
    protocolVersion: OPENPETS_IPC_PROTOCOL_VERSION,
    transport: "ipc",
    capabilities: Array.isArray(record.capabilities) ? record.capabilities.filter((item) => item === "event-v2" || item === "window-v1" || item === "speech-v1" || item === "lease-v1" || item === "pet-v1" || item === "multi-pet-v1") : [],
    ready: record.ready,
    activePet: typeof record.activePet === "string" ? record.activePet : null,
    activePets: Array.isArray(record.activePets) ? record.activePets.filter((item) => item && typeof item === "object") as OpenPetsHealthV2["activePets"] : [],
    activeLeases: typeof record.activeLeases === "number" && Number.isFinite(record.activeLeases) ? record.activeLeases : 0,
    managed: typeof record.managed === "boolean" ? record.managed : false,
    ...(typeof record.debug === "boolean" ? { debug: record.debug } : {}),
    ...(record.window !== undefined ? { window: record.window } : {}),
  };
}

function validateEventResult(input: unknown): { ok: true; state: OpenPetsState } {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new OpenPetsClientError("invalid-response", "OpenPets event response must be an object");
  const record = input as Record<string, unknown>;
  if (!isOpenPetsState(record.state)) throw new OpenPetsClientError("invalid-response", "OpenPets event response is missing state");
  return { ok: true, state: record.state };
}

function validateWindowActionResult(input: unknown): { ok: true; action: OpenPetsWindowAction } {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new OpenPetsClientError("invalid-response", "OpenPets window response must be an object");
  const record = input as Record<string, unknown>;
  if (!isOpenPetsWindowAction(record.action)) throw new OpenPetsClientError("invalid-response", "OpenPets window response is missing action");
  return { ok: true, action: record.action };
}

function validateSelectPetResult(input: unknown): { ok: true; pet: { id: string; displayName: string; directory: string } } {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new OpenPetsClientError("invalid-response", "OpenPets pet response must be an object");
  const record = input as Record<string, unknown>;
  const pet = record.pet;
  if (!pet || typeof pet !== "object" || Array.isArray(pet)) throw new OpenPetsClientError("invalid-response", "OpenPets pet response is missing pet");
  const petRecord = pet as Record<string, unknown>;
  if (typeof petRecord.id !== "string" || typeof petRecord.displayName !== "string" || typeof petRecord.directory !== "string") {
    throw new OpenPetsClientError("invalid-response", "OpenPets pet response is invalid");
  }
  return { ok: true, pet: { id: petRecord.id, displayName: petRecord.displayName, directory: petRecord.directory } };
}

function validateLeaseResult(input: unknown): LeaseResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new OpenPetsClientError("invalid-response", "OpenPets lease response must be an object");
  const record = input as Record<string, unknown>;
  if (record.action !== "acquire" && record.action !== "heartbeat" && record.action !== "release") throw new OpenPetsClientError("invalid-response", "OpenPets lease response is missing action");
  if (typeof record.activeLeases !== "number" || !Number.isInteger(record.activeLeases) || record.activeLeases < 0) throw new OpenPetsClientError("invalid-response", "OpenPets lease response is missing activeLeases");
  if (typeof record.managed !== "boolean" || typeof record.leaseActive !== "boolean" || typeof record.changed !== "boolean") throw new OpenPetsClientError("invalid-response", "OpenPets lease response is missing required fields");
  return {
    action: record.action,
    activeLeases: record.activeLeases,
    managed: record.managed,
    leaseActive: record.leaseActive,
    changed: record.changed,
  };
}

function remainingMs(deadline: number) {
  return Math.max(1, deadline - Date.now());
}

function createRequestId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function toClientError(error: unknown): OpenPetsClientError {
  if (error instanceof OpenPetsClientError) return error;
  if (error && typeof error === "object" && "code" in error && (error.code === "ENOENT" || error.code === "ECONNREFUSED")) return new OpenPetsClientError("not-running", "OpenPets is not running or cannot be reached", { cause: error });
  return new OpenPetsClientError("network-error", "OpenPets request failed", { cause: error });
}
