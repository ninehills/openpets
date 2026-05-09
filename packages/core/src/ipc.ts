import { mkdir, lstat, stat, chmod } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { createConnection, type Socket } from "node:net";
import { validateOpenPetsEvent, type OpenPetsEvent } from "./event.js";
import type { OpenPetsState } from "./states.js";
import { validateLeaseParams, type LeaseParams } from "./lifecycle.js";

export const OPENPETS_IPC_PROTOCOL_VERSION = 2;
export const MAX_IPC_FRAME_BYTES = 16 * 1024;
export const MAX_IPC_ID_LENGTH = 80;
export const DEFAULT_IPC_TIMEOUT_MS = 1000;
export const SAFE_IPC_TIMEOUT_MS = 400;

export type OpenPetsIpcMethod = "health" | "event" | "window" | "lease" | "pet";
export type OpenPetsWindowAction = "show" | "hide" | "sleep" | "quit";
export type SelectPetParams = { path: string };

export type IpcRequest = {
  id: string;
  method: OpenPetsIpcMethod;
  params?: unknown;
};

export type IpcResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: { code: IpcErrorCode; message: string } };

export type IpcErrorCode =
  | "invalid-json"
  | "invalid-request"
  | "unknown-method"
  | "invalid-params"
  | "payload-too-large"
  | "timeout"
  | "internal-error";

export type OpenPetsHealthPet = {
  leaseId: string;
  agentType: string;
  detail: string;
  petName: string | null;
  state: OpenPetsState;
};

export type OpenPetsHealthV2 = {
  app: "openpets";
  ok: true;
  version: string;
  protocolVersion: 2;
  transport: "ipc";
  capabilities: Array<"event-v2" | "window-v1" | "speech-v1" | "lease-v1" | "pet-v1" | "multi-pet-v1">;
  ready: boolean;
  activePet: string | null;
  activePets: OpenPetsHealthPet[];
  activeLeases: number;
  managed: boolean;
  debug?: boolean;
  window?: unknown;
};

export type ValidatedIpcRequest =
  | { id: string; method: "health"; params: undefined }
  | { id: string; method: "event"; params: OpenPetsEvent }
  | { id: string; method: "window"; params: { action: OpenPetsWindowAction } }
  | { id: string; method: "lease"; params: LeaseParams }
  | { id: string; method: "pet"; params: SelectPetParams };

export type IpcDispatcherHandlers = {
  health(): unknown | Promise<unknown>;
  event(event: OpenPetsEvent): unknown | Promise<unknown>;
  window(action: OpenPetsWindowAction): unknown | Promise<unknown>;
  lease?(params: LeaseParams): unknown | Promise<unknown>;
  pet?(params: SelectPetParams): unknown | Promise<unknown>;
};

export type IpcEndpointOptions = {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  uid?: number;
};

export type IpcParentSafetyOptions = {
  platform?: NodeJS.Platform;
  uid?: number;
};

export type IpcEndpointStatus =
  | { status: "missing" }
  | { status: "unsafe-existing-path"; reason: string }
  | { status: "stale-socket"; reason: string }
  | { status: "live-openpets" }
  | { status: "invalid-live-service"; reason: string };

export function getDefaultOpenPetsIpcEndpoint(options: IpcEndpointOptions = {}) {
  const env = options.env ?? process.env;
  const explicit = env.OPENPETS_IPC_ENDPOINT?.trim();
  if (explicit) return explicit;

  const platform = options.platform ?? process.platform;
  const uid = options.uid ?? getCurrentUid();

  if (platform === "win32") {
    const suffixParts = [env.USERDOMAIN, env.USERNAME ?? env.USER, env.SESSIONNAME, String(uid ?? "")].filter(Boolean);
    const suffix = sanitizePipeSuffix(suffixParts.join("-") || "user");
    return `\\\\.\\pipe\\openpets-${suffix}`;
  }

  if (env.XDG_RUNTIME_DIR?.trim()) {
    return join(env.XDG_RUNTIME_DIR, "openpets", "openpets.sock");
  }

  return join("/tmp", `openpets-${uid ?? "unknown"}`, "openpets.sock");
}

export async function ensureSafeIpcParentDirectory(endpoint: string, options: IpcParentSafetyOptions = {}) {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") return;

  if (!isAbsolute(endpoint)) {
    throw new Error(`OpenPets IPC endpoint must be an absolute path: ${endpoint}`);
  }

  const uid = options.uid ?? getCurrentUid();
  const parent = dirname(endpoint);

  const existingParent = await lstat(parent).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });

  if (!existingParent) {
    await mkdir(parent, { recursive: true, mode: 0o700 });
  }

  const parentLink = await lstat(parent);
  if (parentLink.isSymbolicLink()) {
    throw new Error(`OpenPets IPC parent directory must not be a symlink: ${parent}`);
  }
  if (!parentLink.isDirectory()) {
    throw new Error(`OpenPets IPC parent path must be a directory: ${parent}`);
  }
  if (!existingParent) {
    await chmod(parent, 0o700).catch(() => undefined);
  }
  const parentStat = await stat(parent);
  if (uid !== undefined && parentStat.uid !== uid) {
    throw new Error(`OpenPets IPC parent directory is owned by uid ${parentStat.uid}, expected ${uid}: ${parent}`);
  }
  if ((parentStat.mode & 0o077) !== 0) {
    throw new Error(`OpenPets IPC parent directory must not be accessible by group/other: ${parent}`);
  }

  const socketLink = await lstat(endpoint).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (socketLink?.isSymbolicLink()) {
    throw new Error(`OpenPets IPC socket path must not be a symlink: ${endpoint}`);
  }
  if (socketLink && !socketLink.isSocket()) {
    throw new Error(`OpenPets IPC endpoint exists and is not a socket: ${endpoint}`);
  }
}

export async function inspectIpcEndpoint(endpoint: string, options: { platform?: NodeJS.Platform; timeoutMs?: number } = {}): Promise<IpcEndpointStatus> {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return probeOpenPetsIpcEndpoint(endpoint, options.timeoutMs ?? SAFE_IPC_TIMEOUT_MS);
  }

  const link = await lstat(endpoint).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });

  if (!link) return { status: "missing" };
  if (link.isSymbolicLink()) return { status: "unsafe-existing-path", reason: "endpoint is a symlink" };
  if (!link.isSocket()) return { status: "unsafe-existing-path", reason: "endpoint exists and is not a socket" };

  return probeOpenPetsIpcEndpoint(endpoint, options.timeoutMs ?? SAFE_IPC_TIMEOUT_MS);
}

export async function probeOpenPetsIpcEndpoint(endpoint: string, timeoutMs = SAFE_IPC_TIMEOUT_MS): Promise<IpcEndpointStatus> {
  const request = serializeIpcRequest({ id: "openpets-probe", method: "health" });
  return new Promise<IpcEndpointStatus>((resolve) => {
    let settled = false;
    let connected = false;
    let buffer = Buffer.alloc(0);
    const socket = createConnection(endpoint);
    const timeout = setTimeout(() => settle({ status: "invalid-live-service", reason: connected ? "probe timed out after connect" : "probe timed out before connect" }), timeoutMs);

    socket.on("connect", () => {
      connected = true;
      socket.write(request);
    });

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, typeof chunk === "string" ? Buffer.from(chunk) : chunk]);
      if (buffer.byteLength > MAX_IPC_FRAME_BYTES) {
        settle({ status: "invalid-live-service", reason: "probe response is too large" });
        return;
      }
      const newlineIndex = buffer.indexOf(0x0a);
      if (newlineIndex < 0) return;

      try {
        const parsed = parseIpcFrame(buffer.subarray(0, newlineIndex + 1));
        if (isOpenPetsHealthResponse(parsed)) {
          settle({ status: "live-openpets" });
        } else {
          settle({ status: "invalid-live-service", reason: "probe response was not OpenPets health" });
        }
      } catch {
        settle({ status: "invalid-live-service", reason: "probe response was invalid JSON" });
      }
    });

    socket.on("end", () => {
      if (!settled && buffer.byteLength > 0) {
        settle({ status: "invalid-live-service", reason: "probe response ended without newline" });
      }
    });

    socket.on("close", () => {
      if (!settled) settle({ status: "invalid-live-service", reason: connected ? "probe closed without response" : "probe closed before connect" });
    });

    socket.on("error", (error: NodeJS.ErrnoException) => {
      if (!connected && (error.code === "ECONNREFUSED" || error.code === "ENOENT")) {
        settle({ status: "stale-socket", reason: error.code });
      } else {
        settle({ status: "invalid-live-service", reason: error.code ?? "probe connection failed" });
      }
    });

    function settle(status: IpcEndpointStatus) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      resolve(status);
    }
  });
}

export function serializeIpcRequest(request: IpcRequest) {
  return serializeIpcFrame(request);
}

export function serializeIpcResponse(response: IpcResponse) {
  return serializeIpcFrame(response);
}

export function parseIpcFrame(frame: string | Buffer): unknown {
  const byteLength = Buffer.byteLength(frame);
  if (byteLength > MAX_IPC_FRAME_BYTES) {
    throw ipcProtocolError("payload-too-large", "IPC frame is too large");
  }
  const text = Buffer.isBuffer(frame) ? frame.toString("utf8") : frame;
  const line = text.endsWith("\n") ? text.slice(0, -1) : text;
  try {
    return JSON.parse(line);
  } catch {
    throw ipcProtocolError("invalid-json", "IPC frame must be valid JSON");
  }
}

export function validateIpcRequest(input: unknown): { ok: true; request: ValidatedIpcRequest } | { ok: false; id: string; code: IpcErrorCode; message: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, id: "", code: "invalid-request", message: "IPC request must be an object" };
  }

  const record = input as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id || id.length > MAX_IPC_ID_LENGTH) {
    return { ok: false, id, code: "invalid-request", message: `id must be a non-empty string <= ${MAX_IPC_ID_LENGTH} chars` };
  }

  if (record.method !== "health" && record.method !== "event" && record.method !== "window" && record.method !== "lease" && record.method !== "pet") {
    return { ok: false, id, code: typeof record.method === "string" ? "unknown-method" : "invalid-request", message: "Unknown IPC method" };
  }

  if (record.method === "health") {
    if (record.params !== undefined) {
      return { ok: false, id, code: "invalid-params", message: "health does not accept params" };
    }
    return { ok: true, request: { id, method: "health", params: undefined } };
  }

  if (record.method === "event") {
    const validation = validateOpenPetsEvent(record.params);
    if (!validation.ok) {
      return { ok: false, id, code: "invalid-params", message: validation.error };
    }
    return { ok: true, request: { id, method: "event", params: validation.event } };
  }

  if (record.method === "lease") {
    const validation = validateLeaseParams(record.params);
    if (!validation.ok) {
      return { ok: false, id, code: "invalid-params", message: validation.error };
    }
    return { ok: true, request: { id, method: "lease", params: validation.params } };
  }

  if (record.method === "pet") {
    const params = record.params;
    const path = params && typeof params === "object" && !Array.isArray(params) ? (params as Record<string, unknown>).path : undefined;
    if (typeof path !== "string" || !path.trim()) {
      return { ok: false, id, code: "invalid-params", message: "pet params must include a path" };
    }
    return { ok: true, request: { id, method: "pet", params: { path: path.trim() } } };
  }

  const params = record.params;
  if (!params || typeof params !== "object" || Array.isArray(params) || !isOpenPetsWindowAction((params as Record<string, unknown>).action)) {
    return { ok: false, id, code: "invalid-params", message: "window params must include a valid action" };
  }
  return { ok: true, request: { id, method: "window", params: { action: (params as { action: OpenPetsWindowAction }).action } } };
}

export async function dispatchIpcRequest(input: unknown, handlers: IpcDispatcherHandlers): Promise<IpcResponse> {
  const validation = validateIpcRequest(input);
  if (!validation.ok) return createIpcErrorResponse(validation.id, validation.code, validation.message);

  try {
    const { request } = validation;
    if (request.method === "health") {
      return { id: request.id, ok: true, result: await handlers.health() };
    }
    if (request.method === "event") {
      return { id: request.id, ok: true, result: await handlers.event(request.params) };
    }
    if (request.method === "lease") {
      if (!handlers.lease) return createIpcErrorResponse(request.id, "unknown-method", "Unknown IPC method");
      return { id: request.id, ok: true, result: await handlers.lease(request.params) };
    }
    if (request.method === "pet") {
      if (!handlers.pet) return createIpcErrorResponse(request.id, "unknown-method", "Unknown IPC method");
      return { id: request.id, ok: true, result: await handlers.pet(request.params) };
    }
    return { id: request.id, ok: true, result: await handlers.window(request.params.action) };
  } catch (error) {
    const code = isIpcProtocolError(error) && isIpcErrorCode(error.code) ? error.code : "internal-error";
    return createIpcErrorResponse(validation.request.id, code, error instanceof Error ? error.message : "OpenPets IPC request failed");
  }
}

export function handleIpcSocket(socket: Socket, handlers: IpcDispatcherHandlers, options: { timeoutMs?: number } = {}) {
  let buffer = Buffer.alloc(0);
  let settled = false;
  const timeout = setTimeout(() => {
    void respond(createIpcErrorResponse("", "timeout", "IPC request timed out"));
  }, options.timeoutMs ?? DEFAULT_IPC_TIMEOUT_MS);

  socket.on("data", (chunk: Buffer) => {
    if (settled) return;
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.byteLength > MAX_IPC_FRAME_BYTES) {
      void respond(createIpcErrorResponse("", "payload-too-large", "IPC frame is too large"));
      return;
    }
    const newlineIndex = buffer.indexOf(0x0a);
    if (newlineIndex < 0) return;
    const frame = buffer.subarray(0, newlineIndex + 1);
    let parsed: unknown;
    try {
      parsed = parseIpcFrame(frame);
    } catch (error) {
      const code = isIpcProtocolError(error) ? error.code : "invalid-json";
      void respond(createIpcErrorResponse("", code, error instanceof Error ? error.message : "Invalid IPC frame"));
      return;
    }
    void dispatchIpcRequest(parsed, handlers).then(respond);
  });

  socket.on("error", () => {
    clearTimeout(timeout);
    settled = true;
  });

  async function respond(response: IpcResponse) {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    const serialized = safelySerializeIpcResponse(response);
    if (serialized) {
      socket.end(serialized);
    } else {
      socket.destroy();
    }
  }
}

export function createIpcErrorResponse(id: string, code: IpcErrorCode, message: string): IpcResponse {
  return { id, ok: false, error: { code, message } };
}

export function isOpenPetsWindowAction(value: unknown): value is OpenPetsWindowAction {
  return value === "show" || value === "hide" || value === "sleep" || value === "quit";
}

function serializeIpcFrame(value: unknown) {
  const frame = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(frame) > MAX_IPC_FRAME_BYTES) {
    throw ipcProtocolError("payload-too-large", "IPC frame is too large");
  }
  return frame;
}

function safelySerializeIpcResponse(response: IpcResponse) {
  try {
    return serializeIpcResponse(response);
  } catch (error) {
    const code = isIpcProtocolError(error) && error.code === "payload-too-large" ? "payload-too-large" : "internal-error";
    try {
      return serializeIpcResponse(createIpcErrorResponse(response.id, code, code === "payload-too-large" ? "IPC response is too large" : "IPC response could not be serialized"));
    } catch {
      return null;
    }
  }
}

function isOpenPetsHealthResponse(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const response = input as Record<string, unknown>;
  if (response.id !== "openpets-probe" || response.ok !== true) return false;
  const result = response.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  const health = result as Record<string, unknown>;
  return health.app === "openpets" && health.ok === true && health.protocolVersion === OPENPETS_IPC_PROTOCOL_VERSION && health.transport === "ipc";
}

function sanitizePipeSuffix(value: string) {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "user";
}

function getCurrentUid() {
  return typeof process.getuid === "function" ? process.getuid() : undefined;
}

function ipcProtocolError(code: IpcErrorCode, message: string) {
  const error = new Error(message) as Error & { code: IpcErrorCode };
  error.code = code;
  return error;
}

function isIpcProtocolError(error: unknown): error is Error & { code: IpcErrorCode } {
  return error instanceof Error && "code" in error && typeof error.code === "string";
}

function isIpcErrorCode(value: string): value is IpcErrorCode {
  return value === "invalid-json"
    || value === "invalid-request"
    || value === "unknown-method"
    || value === "invalid-params"
    || value === "payload-too-large"
    || value === "timeout"
    || value === "internal-error";
}
