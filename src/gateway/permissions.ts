import type { Space } from "../shared/types.js";

export function isToolAllowed(space: Space, toolName: string, installAllowedTools: string[] = ["*"]) {
  if (!installAllowedTools.includes("*") && !installAllowedTools.includes(toolName)) {
    return false;
  }
  const connectorId = toolName.split(".")[0];
  const connector = space.connectors.find((candidate) => candidate.id === connectorId);
  if (!connector?.enabled || connector.status !== "connected") {
    return false;
  }
  return connector.allowedTools.includes(toolName) || connector.allowedTools.includes(`${connectorId}.*`);
}
