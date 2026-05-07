export const INTEGRATIONS_DOCS_URL = "https://openpets.dev/integrations";
export const PET_GALLERY_URL = "https://openpets.dev";

export const GENERIC_MCP_CONFIG = JSON.stringify(
  {
    mcpServers: {
      openpets: {
        type: "stdio",
        command: "bunx",
        args: ["@open-pets/mcp"],
      },
    },
  },
  null,
  2,
);
