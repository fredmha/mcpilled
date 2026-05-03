import type { ConnectorDefinition } from "../../shared/types.js";

export const customConnector: ConnectorDefinition = {
  id: "custom",
  displayName: "Custom MCP Server",
  description: "Add an existing MCP server as an advanced connector.",
  longDescription:
    "Custom MCP Server is the escape hatch for technical users who already have an MCP command.",
  authType: "custom",
  requiredFields: [
    { key: "CONNECTOR_NAME", label: "Connector Name", type: "text", helpText: "A friendly name for this connector." },
    { key: "COMMAND", label: "Command", type: "text", helpText: "The command that starts the MCP server." },
    { key: "ARGUMENTS", label: "Arguments", type: "textarea", helpText: "One argument per line." },
    { key: "ENVIRONMENT", label: "Environment Variables", type: "textarea", helpText: "Optional KEY=value lines." }
  ],
  permissionActions: [
    { id: "use_tools", label: "Use connector actions", safeByDefault: true, toolNames: ["custom.*"] }
  ],
  mcpServer: {
    transport: "stdio",
    command: "${COMMAND}",
    args: ["${ARGUMENTS}"],
    envMapping: {}
  },
  estimatedTools: 0,
  available: true
};
