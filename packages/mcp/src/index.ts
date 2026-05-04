#!/usr/bin/env bun
import { startOpenPetsMcpServer } from "./server.js";

await startOpenPetsMcpServer().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "OpenPets MCP server failed");
  process.exit(1);
});
