import type { ConnectorDefinition } from "../shared/types.js";
import { customConnector } from "./definitions/custom.js";
import { filesystemConnector } from "./definitions/filesystem.js";
import { gmailConnector } from "./definitions/gmail.js";
import { githubConnector } from "./definitions/github.js";

const placeholders: ConnectorDefinition[] = [
  {
    id: "client_portal",
    displayName: "Client Portal Workflow",
    description: "Lovable trigger that requests HubSpot, Supabase DB, and Brand Kit MCP access.",
    longDescription: "Client Portal Workflow is the demo entrypoint Lovable calls to create a governed client portal request.",
    authType: "custom",
    requiredFields: [],
    permissionActions: [
      { id: "create", label: "Create client portal", safeByDefault: true, toolNames: ["client_portal.create"] }
    ],
    mcpServer: { transport: "http", url: "mock://client-portal" },
    estimatedTools: 1,
    available: true
  },
  {
    id: "brand_assets",
    displayName: "Brand Assets MCP",
    description: "Provide brand kit colors, typography, components, and reusable assets.",
    longDescription: "Brand Assets MCP is a live local MCP server for the demo. It exposes approved brand kit context without touching customer-sensitive CRM or production data.",
    authType: "custom",
    requiredFields: [],
    permissionActions: [
      { id: "get_brand_kit", label: "Get brand kit", safeByDefault: true, toolNames: ["brand_assets.get_brand_kit"] },
      { id: "list_assets", label: "List brand assets", safeByDefault: true, toolNames: ["brand_assets.list_assets"] }
    ],
    mcpServer: { transport: "stdio", command: "node", args: ["dist/demo/brandAssetsMcp.js"] },
    estimatedTools: 2,
    available: true
  },
  {
    id: "notion",
    displayName: "Notion",
    description: "Search pages and inspect workspace access.",
    longDescription: "Notion lets this Org MCP search pages and confirm which workspace your integration can access. For the fastest proof of concept, paste an internal integration token and share the relevant pages with that integration in Notion.",
    authType: "token",
    requiredFields: [{ key: "NOTION_TOKEN", label: "Notion Integration Token", type: "password", helpText: "Create an internal Notion integration, copy its token, then share pages/databases with it in Notion." }],
    permissionActions: [
      { id: "search_pages", label: "Search pages", safeByDefault: true, toolNames: ["notion.search_pages"] },
      { id: "fetch_page", label: "Read page details", safeByDefault: true, toolNames: ["notion.fetch_page"] },
      { id: "workspace_info", label: "Check workspace connection", safeByDefault: true, toolNames: ["notion.get_self"] },
      { id: "create_pages", label: "Create pages", safeByDefault: false, toolNames: ["notion.create_page"] }
    ],
    mcpServer: { transport: "http", url: "https://mcp.notion.com/mcp" },
    estimatedTools: 4,
    available: true
  },
  {
    id: "slack",
    displayName: "Slack",
    description: "Search messages and channels.",
    longDescription: "Slack support is prepared for the next MVP slice.",
    authType: "token",
    requiredFields: [{ key: "SLACK_TOKEN", label: "Slack Token", type: "password", helpText: "Paste a Slack app token." }],
    permissionActions: [{ id: "search_messages", label: "Search messages", safeByDefault: true, toolNames: ["slack.search_messages"] }],
    mcpServer: { transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-slack"], envMapping: { SLACK_TOKEN: "SLACK_TOKEN" } },
    estimatedTools: 6,
    available: false
  },
  {
    id: "google-drive",
    displayName: "Google Drive",
    description: "Find and read shared drive files.",
    longDescription: "Google Drive support is prepared for the next MVP slice.",
    authType: "oauth_placeholder",
    requiredFields: [],
    permissionActions: [{ id: "read_files", label: "Read files", safeByDefault: true, toolNames: ["google-drive.read_file"] }],
    mcpServer: { transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-gdrive"] },
    estimatedTools: 5,
    available: false
  },
  {
    id: "supabase_db",
    displayName: "Supabase Prod DB",
    description: "Query customer production data in Supabase.",
    longDescription: "Supabase Prod DB is intentionally sensitive in the demo and should be denied for interns.",
    authType: "token",
    requiredFields: [{ key: "SUPABASE_DATABASE_URL", label: "Supabase Database URL", type: "password", helpText: "Paste a private Supabase database URL." }],
    permissionActions: [{ id: "read_queries", label: "Run read queries", safeByDefault: false, toolNames: ["supabase_db.query"] }],
    mcpServer: { transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-postgres"], envMapping: { DATABASE_URL: "DATABASE_URL" } },
    estimatedTools: 3,
    available: true
  },
  {
    id: "linear",
    displayName: "Linear",
    description: "Search issues and manage product work.",
    longDescription: "Linear support is prepared for the next MVP slice.",
    authType: "token",
    requiredFields: [{ key: "LINEAR_TOKEN", label: "Linear Token", type: "password", helpText: "Paste a Linear API token." }],
    permissionActions: [{ id: "read_issues", label: "Read issues", safeByDefault: true, toolNames: ["linear.search_issues"] }],
    mcpServer: { transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-linear"], envMapping: { LINEAR_TOKEN: "LINEAR_TOKEN" } },
    estimatedTools: 5,
    available: false
  },
  {
    id: "hubspot",
    displayName: "HubSpot",
    description: "Search CRM contacts, companies, and deals.",
    longDescription: "HubSpot support is prepared for the next MVP slice.",
    authType: "token",
    requiredFields: [{ key: "HUBSPOT_TOKEN", label: "HubSpot Token", type: "password", helpText: "Paste a private app token." }],
    permissionActions: [{ id: "read_crm", label: "Read CRM records", safeByDefault: false, toolNames: ["hubspot.search_contacts"] }],
    mcpServer: { transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-hubspot"], envMapping: { HUBSPOT_TOKEN: "HUBSPOT_TOKEN" } },
    estimatedTools: 5,
    available: true
  }
];

export const connectorDefinitions = [
  githubConnector,
  gmailConnector,
  filesystemConnector,
  ...placeholders,
  customConnector
] as const satisfies ConnectorDefinition[];

export function getConnectorDefinition(id: string) {
  return connectorDefinitions.find((connector) => connector.id === id);
}
