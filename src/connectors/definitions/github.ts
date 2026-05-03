import type { ConnectorDefinition } from "../../shared/types.js";

export const githubConnector: ConnectorDefinition = {
  id: "github",
  displayName: "GitHub",
  description: "Connect repositories, issues, PRs, and code search.",
  longDescription:
    "GitHub lets your AI assistant search repos, create issues, read PRs, and inspect code.",
  authType: "token",
  requiredFields: [
    {
      key: "GITHUB_TOKEN",
      label: "GitHub Token",
      type: "password",
      helpText: "Create a GitHub personal access token with repo permissions."
    }
  ],
  permissionActions: [
    { id: "list_repos", label: "List repositories", safeByDefault: true, toolNames: ["github.list_repos"] },
    { id: "search_repositories", label: "Search repositories", safeByDefault: true, toolNames: ["github.search_repositories"] },
    { id: "read_issues", label: "Read issues", safeByDefault: true, toolNames: ["github.get_issue", "github.list_issues"] },
    { id: "create_issues", label: "Create issues", safeByDefault: false, toolNames: ["github.create_issue"] },
    { id: "create_pull_requests", label: "Create pull requests", safeByDefault: false, toolNames: ["github.create_pull_request"] },
    { id: "delete_anything", label: "Delete anything", safeByDefault: false, toolNames: ["github.delete_repository", "github.delete_file"] }
  ],
  mcpServer: {
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    envMapping: {
      GITHUB_TOKEN: "GITHUB_TOKEN"
    }
  },
  estimatedTools: 12,
  available: true
};
