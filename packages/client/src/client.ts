import { isOpenPetsState, type OpenPetsEvent, type OpenPetsState } from "@openpets/core";
import { OpenPetsClientError } from "./errors.js";
import { normalizeEventInput, type OpenPetsEventInput } from "./event-input.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:4738";
const SUPPORTED_PROTOCOL_VERSION = 1;

export type OpenPetsClientOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  verifyOpenPets?: boolean;
};

export type OpenPetsHealth = {
  app: "openpets";
  ok: boolean;
  version: string;
  protocolVersion: 1;
  capabilities: string[];
  ready: boolean;
  activePet: string | null;
  debug?: boolean;
  window?: unknown;
};

export type OpenPetsSafeResult =
  | { ok: true; state?: OpenPetsState }
  | { ok: false; error: OpenPetsClientError };

export type OpenPetsClient = {
  getHealth(options?: OpenPetsClientOptions): Promise<OpenPetsHealth>;
  isRunning(options?: OpenPetsClientOptions): Promise<boolean>;
  sendEvent(event: OpenPetsEventInput, options?: OpenPetsClientOptions): Promise<{ ok: true; state: OpenPetsState }>;
  safeSendEvent(event: OpenPetsEventInput, options?: OpenPetsClientOptions): Promise<OpenPetsSafeResult>;
};

type RequestBudget = {
  controller: AbortController;
  timeout: ReturnType<typeof setTimeout>;
};

export function createOpenPetsClient(options: OpenPetsClientOptions = {}): OpenPetsClient {
  let verifiedBaseUrl: string | null = null;

  function mergedOptions(overrides: OpenPetsClientOptions = {}) {
    return {
      baseUrl: resolveBaseUrl(overrides.baseUrl ?? options.baseUrl),
      timeoutMs: overrides.timeoutMs ?? options.timeoutMs,
      verifyOpenPets: overrides.verifyOpenPets ?? options.verifyOpenPets ?? true,
    };
  }

  async function getHealthForClient(overrides: OpenPetsClientOptions = {}) {
    const merged = mergedOptions(overrides);
    return fetchHealth(merged.baseUrl, merged.timeoutMs ?? 1000);
  }

  async function verifyOpenPets(overrides: OpenPetsClientOptions = {}) {
    const merged = mergedOptions(overrides);
    if (!merged.verifyOpenPets || verifiedBaseUrl === merged.baseUrl) return;
    await fetchHealth(merged.baseUrl, merged.timeoutMs ?? 1000);
    verifiedBaseUrl = merged.baseUrl;
  }

  async function sendEventForClient(event: OpenPetsEventInput, overrides: OpenPetsClientOptions = {}) {
    const merged = mergedOptions(overrides);
    const timeoutMs = merged.timeoutMs ?? 1000;
    const deadline = Date.now() + timeoutMs;
    if (merged.verifyOpenPets && verifiedBaseUrl !== merged.baseUrl) {
      await fetchHealth(merged.baseUrl, remainingMs(deadline));
      verifiedBaseUrl = merged.baseUrl;
    }
    const normalized = normalizeEventInput(event);
    const result = await postEvent(merged.baseUrl, normalized, remainingMs(deadline));
    return result;
  }

  async function safeSendEventForClient(event: OpenPetsEventInput, overrides: OpenPetsClientOptions = {}) {
    try {
      const merged = { ...overrides, timeoutMs: overrides.timeoutMs ?? options.timeoutMs ?? 400 };
      return await sendEventForClient(event, merged);
    } catch (error) {
      return { ok: false, error: toClientError(error) } as const;
    }
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

function resolveBaseUrl(baseUrl: string | undefined) {
  const envBaseUrl = typeof process !== "undefined" ? process.env.OPENPETS_BASE_URL : undefined;
  return (baseUrl ?? envBaseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function remainingMs(deadline: number) {
  return Math.max(1, deadline - Date.now());
}

async function fetchHealth(baseUrl: string, timeoutMs: number): Promise<OpenPetsHealth> {
  const response = await fetchJson(`${baseUrl}/health`, { method: "GET" }, timeoutMs);
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new OpenPetsClientError("invalid-response", "OpenPets health response must be an object");
  }
  const record = response as Record<string, unknown>;
  if (record.app !== "openpets") {
    throw new OpenPetsClientError("not-openpets", "Port is not served by OpenPets");
  }
  if (record.protocolVersion !== SUPPORTED_PROTOCOL_VERSION) {
    throw new OpenPetsClientError("incompatible-protocol", "OpenPets protocol version is not supported");
  }
  if (typeof record.ok !== "boolean" || typeof record.version !== "string" || typeof record.ready !== "boolean") {
    throw new OpenPetsClientError("invalid-response", "OpenPets health response is missing required fields");
  }
  return {
    app: "openpets",
    ok: record.ok,
    version: record.version,
    protocolVersion: SUPPORTED_PROTOCOL_VERSION,
    capabilities: Array.isArray(record.capabilities) ? record.capabilities.filter((item) => typeof item === "string") : [],
    ready: record.ready,
    activePet: typeof record.activePet === "string" ? record.activePet : null,
    ...(typeof record.debug === "boolean" ? { debug: record.debug } : {}),
    ...(record.window !== undefined ? { window: record.window } : {}),
  };
}

async function postEvent(baseUrl: string, event: OpenPetsEvent, timeoutMs: number): Promise<{ ok: true; state: OpenPetsState }> {
  const response = await fetchJson(
    `${baseUrl}/event`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    },
    timeoutMs,
  );
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new OpenPetsClientError("invalid-response", "OpenPets event response must be an object");
  }
  const record = response as Record<string, unknown>;
  if (record.ok !== true) {
    throw new OpenPetsClientError("rejected", typeof record.error === "string" ? record.error : "OpenPets rejected event");
  }
  if (!isOpenPetsState(record.state)) {
    throw new OpenPetsClientError("invalid-response", "OpenPets event response is missing state");
  }
  return { ok: true, state: record.state };
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const budget = createRequestBudget(timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: budget.controller.signal });
    const text = await response.text();
    let body: unknown;
    try {
      body = text.length > 0 ? JSON.parse(text) : null;
    } catch (error) {
      throw new OpenPetsClientError("invalid-response", "OpenPets response was not valid JSON", { status: response.status, cause: error });
    }
    if (!response.ok) {
      const errorMessage = body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `OpenPets request failed with HTTP ${response.status}`;
      throw new OpenPetsClientError("rejected", errorMessage, { status: response.status });
    }
    return body;
  } catch (error) {
    throw toClientError(error);
  } finally {
    clearTimeout(budget.timeout);
  }
}

function createRequestBudget(timeoutMs: number): RequestBudget {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeout };
}

function toClientError(error: unknown): OpenPetsClientError {
  if (error instanceof OpenPetsClientError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new OpenPetsClientError("timeout", "OpenPets request timed out", { cause: error });
  }
  if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
    return new OpenPetsClientError("timeout", "OpenPets request timed out", { cause: error });
  }
  if (error instanceof TypeError) {
    return new OpenPetsClientError("not-running", "OpenPets is not running or cannot be reached", { cause: error });
  }
  return new OpenPetsClientError("network-error", "OpenPets request failed", { cause: error });
}
