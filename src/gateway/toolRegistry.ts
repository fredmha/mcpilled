import type { Space } from "../shared/types.js";
import { connectorDefinitions } from "../connectors/registry.js";

export interface GatewayTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function listGatewayTools(space: Space): GatewayTool[] {
  return space.connectors
    .filter((connector) => connector.enabled && connector.status === "connected")
    .flatMap((connector) => {
      if (connector.capabilities?.length) {
        return connector.capabilities
          .filter((tool) => connector.allowedTools.includes(tool.name) || connector.allowedTools.includes(`${connector.id}.*`))
          .map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema ?? { type: "object", additionalProperties: true }
          }));
      }
      const definition = connectorDefinitions.find((candidate) => candidate.id === connector.id);
      const tools = definition?.permissionActions.flatMap((action) => action.toolNames) ?? connector.allowedTools;
      return [...new Set(tools)]
        .filter((toolName) => connector.allowedTools.includes(toolName) || connector.allowedTools.includes(`${connector.id}.*`))
        .map((toolName) => toolName.endsWith(".*") ? `${connector.id}.use_tool` : toolName)
        .map((toolName) => ({
          name: toolName,
          description: `${definition?.displayName ?? connector.displayNameOverride ?? connector.id}: ${toolName.split(".").slice(1).join(" ")}`,
          inputSchema: { type: "object", additionalProperties: true }
        }));
    });
}
