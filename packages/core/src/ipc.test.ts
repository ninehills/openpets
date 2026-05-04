import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createConnection, createServer, type Server } from "node:net";
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  dispatchIpcRequest,
  ensureSafeIpcParentDirectory,
  getDefaultOpenPetsIpcEndpoint,
  handleIpcSocket,
  inspectIpcEndpoint,
  parseIpcFrame,
  serializeIpcRequest,
  type IpcDispatcherHandlers,
} from "./ipc.js";

const tempDirs: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("IPC endpoint helpers", () => {
  test("uses OPENPETS_IPC_ENDPOINT when provided", () => {
    expect(getDefaultOpenPetsIpcEndpoint({ env: { OPENPETS_IPC_ENDPOINT: "/custom/openpets.sock" }, platform: "darwin", uid: 501 })).toBe("/custom/openpets.sock");
  });

  test("uses XDG_RUNTIME_DIR on Unix platforms", () => {
    expect(getDefaultOpenPetsIpcEndpoint({ env: { XDG_RUNTIME_DIR: "/run/user/501" }, platform: "linux", uid: 501 })).toBe("/run/user/501/openpets/openpets.sock");
  });

  test("falls back to per-user tmp directory on Unix platforms", () => {
    expect(getDefaultOpenPetsIpcEndpoint({ env: {}, platform: "darwin", uid: 501 })).toBe("/tmp/openpets-501/openpets.sock");
  });

  test("uses a per-user Windows named pipe", () => {
    expect(getDefaultOpenPetsIpcEndpoint({ env: { USERDOMAIN: "LAPTOP", USERNAME: "Alvin User", SESSIONNAME: "Console" }, platform: "win32", uid: 501 })).toBe("\\\\.\\pipe\\openpets-LAPTOP-Alvin-User-Console-501");
  });

  test("creates a private non-symlink parent directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openpets-ipc-"));
    tempDirs.push(dir);
    const endpoint = join(dir, "nested", "openpets.sock");
    await expect(ensureSafeIpcParentDirectory(endpoint, { uid: process.getuid?.() })).resolves.toBeUndefined();
  });

  test("rejects symlinked socket paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openpets-ipc-"));
    tempDirs.push(dir);
    const target = join(dir, "target.sock");
    const endpoint = join(dir, "openpets.sock");
    await symlink(target, endpoint);
    await expect(ensureSafeIpcParentDirectory(endpoint, { uid: process.getuid?.() })).rejects.toThrow("must not be a symlink");
  });

  test("rejects relative Unix endpoint paths", async () => {
    await expect(ensureSafeIpcParentDirectory("relative/openpets.sock", { platform: "linux" })).rejects.toThrow("must be an absolute path");
  });

  test("rejects symlinked parent directories", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openpets-ipc-"));
    tempDirs.push(dir);
    const target = join(dir, "target");
    const parent = join(dir, "parent-link");
    await mkdir(target);
    await symlink(target, parent);
    await expect(ensureSafeIpcParentDirectory(join(parent, "openpets.sock"), { uid: process.getuid?.() })).rejects.toThrow("parent directory must not be a symlink");
  });

  test("rejects existing non-socket endpoint paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openpets-ipc-"));
    tempDirs.push(dir);
    const endpoint = join(dir, "openpets.sock");
    await writeFile(endpoint, "not a socket");
    await expect(ensureSafeIpcParentDirectory(endpoint, { uid: process.getuid?.() })).rejects.toThrow("exists and is not a socket");
    await expect(inspectIpcEndpoint(endpoint)).resolves.toMatchObject({ status: "unsafe-existing-path" });
  });

  test("classifies live OpenPets IPC endpoints", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openpets-ipc-"));
    tempDirs.push(dir);
    const endpoint = join(dir, "openpets.sock");
    const server = createServer((socket) => handleIpcSocket(socket, {
      health: () => ({ app: "openpets", ok: true, version: "0.0.0", protocolVersion: 2, transport: "ipc", capabilities: ["event-v2", "lease-v1"], ready: true, activePet: null, activeLeases: 0, managed: false }),
      event: (event) => ({ state: event.state }),
      window: (action) => ({ action }),
      lease: (params) => ({ action: params.action }),
    }));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(endpoint, resolve));
    await expect(inspectIpcEndpoint(endpoint)).resolves.toEqual({ status: "live-openpets" });
  });

  test("classifies invalid live services without treating them as stale", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openpets-ipc-"));
    tempDirs.push(dir);
    const endpoint = join(dir, "openpets.sock");
    const server = createServer((socket) => socket.end('{"id":"openpets-probe","ok":true,"result":{"app":"other"}}\n'));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(endpoint, resolve));
    await expect(inspectIpcEndpoint(endpoint)).resolves.toMatchObject({ status: "invalid-live-service" });
    await expect(lstat(endpoint)).resolves.toMatchObject({});
    expect((await lstat(endpoint)).isSocket()).toBe(true);
  });

  test("classifies connected services that close without response as invalid live services", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openpets-ipc-"));
    tempDirs.push(dir);
    const endpoint = join(dir, "openpets.sock");
    const server = createServer((socket) => socket.end());
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(endpoint, resolve));
    await expect(inspectIpcEndpoint(endpoint)).resolves.toMatchObject({ status: "invalid-live-service" });
  });

  test("classifies existing sockets with no listener as stale", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openpets-ipc-"));
    tempDirs.push(dir);
    const endpoint = join(dir, "openpets.sock");
    createStaleUnixSocket(endpoint);
    expect((await lstat(endpoint)).isSocket()).toBe(true);
    await expect(inspectIpcEndpoint(endpoint)).resolves.toMatchObject({ status: "stale-socket" });
  });
});

describe("IPC framing and dispatcher", () => {
  const handlers: IpcDispatcherHandlers = {
    health: () => ({ app: "openpets", ok: true }),
    event: (event) => ({ state: event.state }),
    window: (action) => ({ action }),
    lease: (params) => ({ action: params.action, id: params.id }),
  };

  test("serializes newline-delimited JSON requests", () => {
    expect(serializeIpcRequest({ id: "1", method: "health" })).toBe('{"id":"1","method":"health"}\n');
  });

  test("parses framed JSON", () => {
    expect(parseIpcFrame('{"id":"1","method":"health"}\n')).toEqual({ id: "1", method: "health" });
  });

  test("dispatches health requests", async () => {
    await expect(dispatchIpcRequest({ id: "1", method: "health" }, handlers)).resolves.toEqual({ id: "1", ok: true, result: { app: "openpets", ok: true } });
  });

  test("validates event params before dispatch", async () => {
    await expect(dispatchIpcRequest({ id: "2", method: "event", params: { type: "state.testing", state: "testing" } }, handlers)).resolves.toEqual({ id: "2", ok: true, result: { state: "testing" } });
    await expect(dispatchIpcRequest({ id: "3", method: "event", params: { type: "bad", state: "nope" } }, handlers)).resolves.toMatchObject({ id: "3", ok: false, error: { code: "invalid-params" } });
  });

  test("validates window actions", async () => {
    await expect(dispatchIpcRequest({ id: "4", method: "window", params: { action: "hide" } }, handlers)).resolves.toEqual({ id: "4", ok: true, result: { action: "hide" } });
    await expect(dispatchIpcRequest({ id: "5", method: "window", params: { action: "explode" } }, handlers)).resolves.toMatchObject({ id: "5", ok: false, error: { code: "invalid-params" } });
  });

  test("validates lease params before dispatch", async () => {
    await expect(dispatchIpcRequest({ id: "6", method: "lease", params: { action: "acquire", id: " mcp:1 ", client: "mcp" } }, handlers)).resolves.toEqual({ id: "6", ok: true, result: { action: "acquire", id: "mcp:1" } });
    await expect(dispatchIpcRequest({ id: "7", method: "lease", params: { action: "acquire", id: "mcp:1", client: "bad" } }, handlers)).resolves.toMatchObject({ id: "7", ok: false, error: { code: "invalid-params" } });
  });

  test("returns unknown-method when lease handler is unavailable", async () => {
    const noLeaseHandlers: IpcDispatcherHandlers = {
      health: () => ({}),
      event: () => ({}),
      window: () => ({}),
    };
    await expect(dispatchIpcRequest({ id: "8", method: "lease", params: { action: "release", id: "mcp:1" } }, noLeaseHandlers)).resolves.toMatchObject({ id: "8", ok: false, error: { code: "unknown-method" } });
  });
});

describe("IPC socket protocol", () => {
  test("serves one JSON response and closes the connection", async () => {
    const server = createServer((socket) => handleIpcSocket(socket, {
      health: () => ({ ready: true }),
      event: (event) => ({ state: event.state }),
      window: (action) => ({ action }),
    }));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP server address");

    const response = await requestTcpFrame(address.port, serializeIpcRequest({ id: "health-1", method: "health" }));
    expect(JSON.parse(response)).toEqual({ id: "health-1", ok: true, result: { ready: true } });
  });

  test("returns protocol errors for invalid JSON", async () => {
    const server = createServer((socket) => handleIpcSocket(socket, {
      health: () => ({}),
      event: () => ({}),
      window: () => ({}),
    }));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP server address");

    const response = await requestTcpFrame(address.port, "not-json\n");
    expect(JSON.parse(response)).toMatchObject({ ok: false, error: { code: "invalid-json" } });
  });

  test("returns payload-too-large when handler response is oversized", async () => {
    const server = createServer((socket) => handleIpcSocket(socket, {
      health: () => ({ text: "x".repeat(20 * 1024) }),
      event: () => ({}),
      window: () => ({}),
    }));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP server address");

    const response = await requestTcpFrame(address.port, serializeIpcRequest({ id: "too-large", method: "health" }));
    expect(JSON.parse(response)).toMatchObject({ id: "too-large", ok: false, error: { code: "payload-too-large" } });
  });

  test("times out when no newline-delimited request arrives", async () => {
    const server = createServer((socket) => handleIpcSocket(socket, {
      health: () => ({}),
      event: () => ({}),
      window: () => ({}),
    }, { timeoutMs: 20 }));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP server address");

    const response = await requestTcpFrame(address.port, '{"id":"slow"');
    expect(JSON.parse(response)).toMatchObject({ ok: false, error: { code: "timeout" } });
  });
});

function requestTcpFrame(port: number, frame: string) {
  return new Promise<string>((resolve, reject) => {
    let response = "";
    const socket = createConnection({ host: "127.0.0.1", port }, () => socket.write(frame));
    socket.on("data", (data) => {
      response += data.toString("utf8");
    });
    socket.on("end", () => resolve(response.trimEnd()));
    socket.on("error", reject);
  });
}

function createStaleUnixSocket(endpoint: string) {
  const result = spawnSync("python3", ["-c", "import socket, sys\ns = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)\ns.bind(sys.argv[1])\ns.close()", endpoint]);
  if (result.status !== 0) {
    throw new Error(`Failed to create stale Unix socket fixture: ${result.stderr.toString() || result.error?.message || "unknown error"}`);
  }
}
