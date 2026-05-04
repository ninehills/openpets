import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerOpenPetsTools } from "./tools.js";

export function createOpenPetsMcpServer() {
  const server = new McpServer(
    { name: "openpets", version: "0.0.0" },
    {
      instructions: "Use OpenPets tools for concise local pet status updates. Never include secrets, code, file paths, command output, logs, diffs, URLs, or exact errors.",
    },
  );
  registerOpenPetsTools(server);
  return server;
}

export async function startOpenPetsMcpServer() {
  const server = createOpenPetsMcpServer();
  await server.connect(new StdioServerTransport());
}
