import { chmod, lstat, unlink } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import {
  type IpcDispatcherHandlers,
  type OpenPetsHealthV2,
  type OpenPetsWindowAction,
  ensureSafeIpcParentDirectory,
  getDefaultOpenPetsIpcEndpoint,
  handleIpcSocket,
  inspectIpcEndpoint,
} from "@openpets/core/ipc";
import type { OpenPetsEvent } from "@openpets/core";

export type DesktopIpcHandlerContext = {
  getHealth(): OpenPetsHealthV2;
  applyEvent(event: OpenPetsEvent): void;
  handleWindowAction(action: OpenPetsWindowAction): void | Promise<void>;
};

export type DesktopIpcServerHandle = {
  endpoint: string;
  close(): Promise<void>;
};

export function createDesktopIpcHandlers(context: DesktopIpcHandlerContext): IpcDispatcherHandlers {
  return {
    health: () => context.getHealth(),
    event: (event) => {
      context.applyEvent(event);
      return { state: event.state };
    },
    window: async (action) => {
      await context.handleWindowAction(action);
      return { action };
    },
  };
}

export async function startDesktopIpcServer(options: { endpoint?: string; handlers: IpcDispatcherHandlers; onError?: (error: Error) => void }): Promise<DesktopIpcServerHandle> {
  const endpoint = options.endpoint ?? getDefaultOpenPetsIpcEndpoint();
  const platform = process.platform;

  await ensureSafeIpcParentDirectory(endpoint, { platform });
  const endpointStatus = await inspectIpcEndpoint(endpoint, { platform });

  if (endpointStatus.status === "live-openpets") {
    throw new Error(`OpenPets IPC endpoint is already served by OpenPets: ${endpoint}`);
  }
  if (endpointStatus.status === "invalid-live-service" || endpointStatus.status === "unsafe-existing-path") {
    throw new Error(`OpenPets IPC endpoint is not safe to use: ${endpointStatus.reason}`);
  }
  if (endpointStatus.status === "stale-socket" && platform !== "win32") {
    const link = await lstat(endpoint);
    if (link.isSymbolicLink() || !link.isSocket()) {
      throw new Error("OpenPets IPC endpoint changed before stale socket cleanup");
    }
    await unlink(endpoint);
  }

  const server = createServer((socket) => handleIpcSocket(socket, options.handlers));
  const nodeServer = server as Server & {
    on(event: "error", listener: (error: Error) => void): void;
    once(event: "error", listener: (error: Error) => void): void;
    off(event: "error", listener: (error: Error) => void): void;
  };
  nodeServer.on("error", (error) => options.onError?.(error));
  await new Promise<void>((resolve, reject) => {
    nodeServer.once("error", reject);
    server.listen(endpoint, () => {
      nodeServer.off("error", reject);
      resolve();
    });
  });

  if (platform !== "win32") {
    await chmod(endpoint, 0o600).catch(() => undefined);
  }

  return {
    endpoint,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (platform !== "win32") {
        const link = await lstat(endpoint).catch(() => null);
        if (link?.isSocket() && !link.isSymbolicLink()) await unlink(endpoint).catch(() => undefined);
      }
    },
  };
}

export type { Server as DesktopIpcNodeServer };
