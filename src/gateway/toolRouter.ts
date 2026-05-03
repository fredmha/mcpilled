import type { GatewayConfig, InstallProfile } from "../shared/types.js";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { getConnectorDefinition } from "../connectors/registry.js";
import { getConnectorCredentials } from "../config/secrets.js";
import { callDownstreamTool } from "./downstreamMcp.js";
import { logActivity } from "./activityLogger.js";
import { auditToolResult, evaluatePolicy, queueApproval, queueWorkflowApproval, type ActorContext } from "./governance.js";
import { isToolAllowed } from "./permissions.js";
import { listGatewayTools } from "./toolRegistry.js";

export async function handleToolList(config: GatewayConfig) {
  return {
    tools: listGatewayTools(config.spaces[0])
  };
}

export async function handleToolCall(config: GatewayConfig, toolName: string, args: Record<string, unknown>, client = "AI assistant", installProfile?: InstallProfile, actor: ActorContext = { userId: "demo-user", teamId: "engineering" }) {
  const started = Date.now();
  const space = config.spaces[0];
  const connectorId = toolName.split(".")[0];
  const definition = getConnectorDefinition(connectorId);
  if (!isToolAllowed(space, toolName, installProfile?.allowedTools)) {
    await auditToolResult(actor, toolName, args, "denied", ["gateway-permissions:blocked"], undefined, "Blocked by connector or install permissions.");
    await logActivity({
      client,
      installProfileId: installProfile?.id,
      connectorId,
      connectorName: definition?.displayName ?? connectorId,
      action: humanizeTool(toolName),
      status: "blocked",
      durationMs: Date.now() - started,
      detail: "Blocked by permissions"
    });
    throw new Error("Blocked by permissions");
  }
  if (toolName === "client_portal.create") {
    const requestedTools = clientPortalRequestedTools(args);
    const approval = await queueWorkflowApproval(
      { userId: actor.userId === "demo-user" ? "intern" : actor.userId, teamId: actor.teamId === "engineering" ? "interns" : actor.teamId },
      args,
      requestedTools,
      ["workflow:client_portal.create:approval", "hubspot:sensitive:deny", "prod_db:sensitive:deny", "canva_ai:creative:approval"]
    );
    await logActivity({
      client,
      installProfileId: installProfile?.id,
      connectorId,
      connectorName: definition?.displayName ?? connectorId,
      action: "Create Client Portal",
      status: "blocked",
      durationMs: Date.now() - started,
      detail: `Pending bundled approval ${approval.id}`
    });
    return {
      content: [{ type: "text", text: `Approval required. Review bundled request ${approval.id}; only Canva AI should be approved for this demo.` }],
      approval: { id: approval.id, status: approval.status, requestedTools }
    };
  }
  const policy = await evaluatePolicy(actor, toolName);
  if (policy.decision === "deny") {
    await auditToolResult(actor, toolName, args, "denied", policy.trace, undefined, policy.matchedRule.reason);
    await logActivity({
      client,
      installProfileId: installProfile?.id,
      connectorId,
      connectorName: definition?.displayName ?? connectorId,
      action: humanizeTool(toolName),
      status: "blocked",
      durationMs: Date.now() - started,
      detail: policy.matchedRule.reason
    });
    throw new Error(`Denied by policy: ${policy.matchedRule.reason}`);
  }
  if (policy.decision === "approval") {
    const approval = await queueApproval(actor, toolName, args, policy.trace);
    await logActivity({
      client,
      installProfileId: installProfile?.id,
      connectorId,
      connectorName: definition?.displayName ?? connectorId,
      action: humanizeTool(toolName),
      status: "blocked",
      durationMs: Date.now() - started,
      detail: `Pending approval ${approval.id}`
    });
    return {
      content: [{ type: "text", text: `Approval required. Pending request: ${approval.id}` }],
      approval: { id: approval.id, status: approval.status }
    };
  }
  try {
    const result = await executeApprovedTool(config, toolName, args);
    await auditToolResult(actor, toolName, args, "success", policy.trace, result, "Executed after policy allow.");
    await logActivity({
      client,
      installProfileId: installProfile?.id,
      connectorId,
      connectorName: definition?.displayName ?? connectorId,
      action: humanizeTool(toolName),
      status: "success",
      durationMs: Date.now() - started,
      detail: "Executed by MCP Gateway"
    });
    return result;
  } catch (error) {
    await logActivity({
      client,
      installProfileId: installProfile?.id,
      connectorId,
      connectorName: definition?.displayName ?? connectorId,
      action: humanizeTool(toolName),
      status: "error",
      durationMs: Date.now() - started,
      detail: error instanceof Error ? error.message : "Tool failed"
    });
    throw error;
  }
}

export async function executeApprovedTool(config: GatewayConfig, toolName: string, args: Record<string, unknown>) {
  return executeLocalTool(config, toolName, args);
}

function humanizeTool(toolName: string) {
  return toolName
    .split(".")
    .slice(1)
    .join(" ")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function executeLocalTool(config: GatewayConfig, toolName: string, args: Record<string, unknown>) {
  if (toolName.startsWith("filesystem.")) {
    return executeFilesystemTool(toolName, args);
  }
  if (toolName.startsWith("github.")) {
    return executeGithubTool(toolName, args);
  }
  if (toolName.startsWith("notion.")) {
    return executeNotionTool(toolName, args);
  }
  if (toolName.startsWith("gmail.")) {
    return executeGmailTool(toolName, args);
  }
  if (toolName.startsWith("canva_ai.")) {
    return executeCanvaAiTool(config, toolName, args);
  }
  if (toolName.startsWith("hubspot.")) {
    return executeHubSpotTool(toolName, args);
  }
  if (toolName.startsWith("prod_db.")) {
    return executeProdDbTool(toolName, args);
  }
  const connectorId = toolName.split(".")[0];
  const connector = config.spaces[0].connectors.find((candidate) => candidate.id === connectorId);
  if (connector?.mcpServer) {
    return callDownstreamTool(connector.mcpServer, toolName, args);
  }
  return textResult(`MCP Gateway accepted ${toolName}. Configure METAMCP_UPSTREAM_URL to delegate execution to MetaMCP.`);
}

export function clientPortalRequestedTools(args: Record<string, unknown>) {
  const clientName = typeof args.clientName === "string" && args.clientName.trim() ? args.clientName.trim() : "Acme Health";
  const portalGoal = typeof args.portalGoal === "string" && args.portalGoal.trim() ? args.portalGoal.trim() : "Create a custom client portal for onboarding and reporting.";
  return [
    {
      server: "hubspot",
      tool: "hubspot.search_contacts",
      reason: `Find CRM contacts and account context for ${clientName}.`,
      flagReason: "Contains customer CRM records and contact details.",
      currentPolicy: "deny" as const,
      input: { query: clientName, properties: ["contacts", "companies", "deals"] }
    },
    {
      server: "prod_db",
      tool: "prod_db.query",
      reason: `Query production usage and billing data for ${clientName}.`,
      flagReason: "Production database contains customer-sensitive data.",
      currentPolicy: "deny" as const,
      input: { sql: "select * from customer_portal_context where client_name = $1", params: [clientName] }
    },
    {
      server: "canva_ai",
      tool: "canva_ai.create_client_portal_asset",
      reason: `Generate safe branded portal creative for: ${portalGoal}`,
      flagReason: "Creative generation does not require customer-sensitive source data.",
      currentPolicy: "require_approval" as const,
      input: { clientName, portalGoal, assetType: "client_portal_mockup" }
    },
    {
      server: "brand_assets",
      tool: "brand_assets.get_brand_kit",
      reason: `Pull approved brand kit assets for ${clientName}'s portal design.`,
      flagReason: "Brand assets are pre-approved design context and do not expose customer records.",
      currentPolicy: "allow" as const,
      input: { clientName, portalGoal }
    }
  ];
}

async function executeFilesystemTool(toolName: string, args: Record<string, unknown>) {
  const credentials = await getConnectorCredentials("default", "filesystem");
  const root = resolve(credentials.ROOT_PATH ?? process.cwd());
  const requestedPath = typeof args.path === "string" ? args.path : ".";
  const target = resolve(join(root, requestedPath));
  if (!isInsideRoot(root, target)) {
    throw new Error("Requested path is outside the approved folder.");
  }
  if (toolName === "filesystem.read_file") {
    return textResult(await readFile(target, "utf8"));
  }
  if (toolName === "filesystem.list_directory") {
    const entries = await readdir(target, { withFileTypes: true });
    return textResult(entries.map((entry) => `${entry.isDirectory() ? "folder" : "file"} ${entry.name}`).join("\n"));
  }
  if (toolName === "filesystem.search_files") {
    const query = typeof args.query === "string" ? args.query.toLowerCase() : "";
    if (!query) {
      throw new Error("Search query is required.");
    }
    const matches: string[] = [];
    await collectFileMatches(root, root, query, matches);
    return textResult(matches.slice(0, 100).join("\n") || "No matching files found.");
  }
  if (toolName === "filesystem.write_file") {
    const content = typeof args.content === "string" ? args.content : "";
    await writeFile(target, content);
    return textResult("File written.");
  }
  throw new Error(`Unsupported filesystem action: ${toolName}`);
}

async function collectFileMatches(root: string, current: string, query: string, matches: string[]) {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (matches.length >= 100) return;
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const fullPath = join(current, entry.name);
    if (!isInsideRoot(root, fullPath)) continue;
    if (entry.name.toLowerCase().includes(query)) {
      matches.push(relative(root, fullPath));
    }
    if (entry.isDirectory()) {
      await collectFileMatches(root, fullPath, query, matches);
    }
  }
}

async function executeGithubTool(toolName: string, args: Record<string, unknown>) {
  const credentials = await getConnectorCredentials("default", "github");
  const token = credentials.GITHUB_TOKEN;
  if (toolName === "github.list_repos") {
    return textResult(JSON.stringify({
      source: "mock-github-mcp",
      repositories: [
        { owner: "acme", name: "demo-api", private: false },
        { owner: "acme", name: "governed-agent", private: true }
      ]
    }, null, 2));
  }
  if (toolName === "github.create_issue" && !token) {
    const title = requireString(args.title, "title");
    return textResult(JSON.stringify({
      source: "mock-github-mcp",
      action: "create_issue",
      issue: {
        id: nanoSafeId("ISSUE"),
        owner: typeof args.owner === "string" ? args.owner : "acme",
        repo: typeof args.repo === "string" ? args.repo : "demo-api",
        title,
        body: typeof args.body === "string" ? args.body : "",
        url: "https://github.example/acme/demo-api/issues/101"
      }
    }, null, 2));
  }
  if (!token) {
    throw new Error("GitHub token is missing.");
  }
  if (toolName === "github.search_repositories") {
    const query = requireString(args.query, "query");
    return githubRequest(token, `/search/repositories?q=${encodeURIComponent(query)}&per_page=10`);
  }
  const owner = requireString(args.owner, "owner");
  const repo = requireString(args.repo, "repo");
  if (toolName === "github.list_issues") {
    return githubRequest(token, `/repos/${owner}/${repo}/issues?per_page=20`);
  }
  if (toolName === "github.get_issue") {
    const issueNumber = requireString(args.issue_number ?? args.issueNumber, "issue_number");
    return githubRequest(token, `/repos/${owner}/${repo}/issues/${issueNumber}`);
  }
  if (toolName === "github.create_issue") {
    const title = requireString(args.title, "title");
    const body = typeof args.body === "string" ? args.body : "";
    return githubRequest(token, `/repos/${owner}/${repo}/issues`, "POST", { title, body });
  }
  throw new Error(`Unsupported GitHub action: ${toolName}`);
}

async function githubRequest(token: string, path: string, method = "GET", body?: Record<string, unknown>) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "mcp-gateway-local"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message ?? "GitHub request failed.");
  }
  return textResult(JSON.stringify(payload, null, 2));
}

async function executeNotionTool(toolName: string, args: Record<string, unknown>) {
  const credentials = await getConnectorCredentials("default", "notion");
  const token = credentials.NOTION_TOKEN;
  if (toolName === "notion.search_pages" && !token) {
    const query = typeof args.query === "string" ? args.query : "";
    return textResult(JSON.stringify({
      source: "mock-notion-mcp",
      query,
      pages: [
        { id: "page_demo_governance", title: "MCP Gateway Governance Demo" },
        { id: "page_policy_notes", title: "Policy Rollout Notes" }
      ]
    }, null, 2));
  }
  if (!token) {
    throw new Error("Notion integration token is missing.");
  }
  if (toolName === "notion.get_self") {
    return notionRequest(token, "/users/me");
  }
  if (toolName === "notion.search_pages") {
    const query = typeof args.query === "string" ? args.query : "";
    return notionRequest(token, "/search", "POST", {
      query,
      filter: { property: "object", value: "page" },
      page_size: typeof args.page_size === "number" ? args.page_size : 10
    });
  }
  if (toolName === "notion.fetch_page") {
    const pageId = requireString(args.page_id ?? args.pageId, "page_id");
    return notionRequest(token, `/pages/${encodeURIComponent(pageId)}`);
  }
  if (toolName === "notion.create_page") {
    const parentPageId = requireString(args.parent_page_id ?? args.parentPageId, "parent_page_id");
    const title = requireString(args.title, "title");
    return notionRequest(token, "/pages", "POST", {
      parent: { page_id: parentPageId },
      properties: {
        title: {
          title: [{ text: { content: title } }]
        }
      }
    });
  }
  throw new Error(`Unsupported Notion action: ${toolName}`);
}

async function notionRequest(token: string, path: string, method = "GET", body?: Record<string, unknown>) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "notion-version": "2022-06-28"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message ?? "Notion request failed.");
  }
  return textResult(JSON.stringify(payload, null, 2));
}

function requireString(value: unknown, name: string) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function textResult(text: string) {
  return { content: [{ type: "text", text }] };
}

async function executeCanvaAiTool(config: GatewayConfig, toolName: string, args: Record<string, unknown>) {
  if (toolName !== "canva_ai.create_client_portal_asset") {
    throw new Error(`Unsupported Canva AI action: ${toolName}`);
  }
  const connector = config.spaces[0].connectors.find((candidate) => candidate.id === "canva_ai");
  if (connector?.mcpServer && !connector.mcpServer.url?.startsWith("mock://")) {
    return callDownstreamTool(connector.mcpServer, toolName, args);
  }
  const clientName = typeof args.clientName === "string" ? args.clientName : "Acme Health";
  const slug = clientName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "client";
  return textResult(JSON.stringify({
    source: "mock-canva-ai-mcp",
    action: "create_client_portal_asset",
    design: {
      id: `canva_${slug}_portal_demo`,
      title: `${clientName} Client Portal Concept`,
      url: `https://canva.example/design/${slug}-client-portal`,
      assetType: typeof args.assetType === "string" ? args.assetType : "client_portal_mockup",
      status: "created"
    }
  }, null, 2));
}

async function executeHubSpotTool(toolName: string, args: Record<string, unknown>) {
  if (toolName !== "hubspot.search_contacts") {
    throw new Error(`Unsupported HubSpot action: ${toolName}`);
  }
  return textResult(JSON.stringify({
    source: "mock-hubspot-mcp",
    query: typeof args.query === "string" ? args.query : "",
    blockedInDemo: true,
    reason: "HubSpot contains customer-sensitive CRM data."
  }, null, 2));
}

async function executeProdDbTool(toolName: string, args: Record<string, unknown>) {
  if (toolName !== "prod_db.query") {
    throw new Error(`Unsupported Prod DB action: ${toolName}`);
  }
  return textResult(JSON.stringify({
    source: "mock-prod-db-mcp",
    sql: typeof args.sql === "string" ? args.sql : "",
    blockedInDemo: true,
    reason: "Production database contains customer-sensitive data."
  }, null, 2));
}

async function executeGmailTool(toolName: string, args: Record<string, unknown>) {
  if (toolName !== "gmail.search_email") {
    throw new Error(`Unsupported Gmail action: ${toolName}`);
  }
  const query = typeof args.query === "string" ? args.query : "";
  return textResult(JSON.stringify({
    source: "mock-gmail-mcp",
    query,
    messages: [
      { id: "msg_001", from: "security@example.com", subject: "Approval workflow review" },
      { id: "msg_002", from: "platform@example.com", subject: "MCP server onboarding" }
    ]
  }, null, 2));
}

function nanoSafeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}`;
}

function isInsideRoot(root: string, target: string) {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !path.includes(`..${sep}`));
}
