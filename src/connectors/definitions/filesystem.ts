import type { ConnectorDefinition } from "../../shared/types.js";

export const filesystemConnector: ConnectorDefinition = {
  id: "filesystem",
  displayName: "Filesystem",
  description: "Let your assistant read and search approved local folders.",
  longDescription:
    "Filesystem lets your AI assistant read approved files and search folders you choose.",
  authType: "path",
  requiredFields: [
    {
      key: "ROOT_PATH",
      label: "Allowed Folder Path",
      type: "text",
      helpText: "Choose the local folder your assistant can use."
    }
  ],
  permissionActions: [
    { id: "read_file", label: "Read files", safeByDefault: true, toolNames: ["filesystem.read_file"] },
    { id: "list_directory", label: "List folders", safeByDefault: true, toolNames: ["filesystem.list_directory"] },
    { id: "search_files", label: "Search files", safeByDefault: true, toolNames: ["filesystem.search_files"] },
    { id: "write_file", label: "Write files", safeByDefault: false, toolNames: ["filesystem.write_file"] },
    { id: "delete_anything", label: "Delete anything", safeByDefault: false, toolNames: ["filesystem.delete_file"] }
  ],
  mcpServer: {
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "${ROOT_PATH}"],
    envMapping: {
      ROOT_PATH: "ROOT_PATH"
    }
  },
  estimatedTools: 7,
  available: true
};
