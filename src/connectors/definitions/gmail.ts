import type { ConnectorDefinition } from "../../shared/types.js";

export const gmailConnector: ConnectorDefinition = {
  id: "gmail",
  displayName: "Gmail",
  description: "Search email with mock local results for governance demos.",
  longDescription: "Gmail is represented by a mock MCP server in this demo so policy enforcement can be shown without external OAuth.",
  authType: "custom",
  requiredFields: [],
  permissionActions: [
    { id: "search_email", label: "Search email", safeByDefault: true, toolNames: ["gmail.search_email"] }
  ],
  mcpServer: {
    transport: "http",
    url: "mock://gmail"
  },
  estimatedTools: 1,
  available: true
};
