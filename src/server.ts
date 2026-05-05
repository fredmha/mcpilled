import express from "express";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { connectorDefinitions, getConnectorDefinition } from "./connectors/registry.js";
import { getSecret, saveConnectorCredentials, saveSecret } from "./config/secrets.js";
import { addInstallProfile, createInstallToken, loadConfig, resetConfig, saveConfig, upsertConnector } from "./config/store.js";
import { registerMcpEndpoint } from "./gateway/mcpEndpoint.js";
import { readRecentActivity } from "./gateway/activityLogger.js";
import { auditToolResult, capabilityIndex, queueApproval, readApprovals, readAudit, readPolicies, replacePolicies, resetGovernanceState, updateApproval } from "./gateway/governance.js";
import { listDownstreamTools, testDownstreamServer } from "./gateway/downstreamMcp.js";
import { readTokenCostOptimisations, recordTokenCostOptimisation, resetTokenCostOptimisations } from "./gateway/tokenCostOptimiser.js";
import { clientPortalRequestedTools, executeApprovedTool, handleToolCall } from "./gateway/toolRouter.js";
import { hashApiKey, previewApiKey } from "./spaces/apiKeys.js";
import type { AgentMessage, ApprovalRequest, AuditLogEntry, InstallProfile, McpServerDefinition, PolicyDecision, PolicyRule, StoredConnector, ToolCapability } from "./shared/types.js";

let loaded = await loadConfig();
let ownerInstallToken = await ensureOwnerInstallToken();

const app = express();
app.use(express.json({ limit: "1mb" }));

function gatewayUrl() {
  if (process.env.MCP_GATEWAY_PUBLIC_URL) {
    return `${process.env.MCP_GATEWAY_PUBLIC_URL.replace(/\/$/, "")}/mcp`;
  }
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN.replace(/\/$/, "")}/mcp`;
  }
  if (process.env.RAILWAY_STATIC_URL) {
    return `${process.env.RAILWAY_STATIC_URL.replace(/\/$/, "")}/mcp`;
  }
  return `http://localhost:${loaded.config.gateway.port}/mcp`;
}

async function installConfigs(profileId = "owner") {
  const token = await getInstallToken(profileId);
  const shared = {
    mcpServers: {
      "org-mcp": {
        url: gatewayUrl(),
        headers: { Authorization: `Bearer ${token}` }
      }
    }
  };
  return {
    universal: JSON.stringify(shared, null, 2),
    lovable: JSON.stringify(shared, null, 2),
    claude: JSON.stringify(shared, null, 2),
    cursor: JSON.stringify(shared, null, 2),
    codex: JSON.stringify(shared, null, 2)
  };
}

function generatedAdvancedConfig() {
  return JSON.stringify(
    {
      gateway: loaded.config.gateway,
      installProfiles: loaded.config.spaces[0].installProfiles.map((profile) => ({
        ...profile,
        tokenHash: "[hidden]"
      })),
      connectors: loaded.config.spaces[0].connectors.map((connector) => ({
        ...connector,
        generatedMcpServer: getConnectorDefinition(connector.id)?.mcpServer
      }))
    },
    null,
    2
  );
}

function mergedConnectors() {
  const stored = loaded.config.spaces[0].connectors;
  const defined = connectorDefinitions.map((definition) => {
    const connector = stored.find((candidate) => candidate.id === definition.id);
    return {
      ...definition,
      enabled: connector?.enabled ?? false,
      status: connector?.status ?? "not_connected",
      toolCount: connector?.toolCount ?? 0,
      allowedTools: connector?.allowedTools ?? []
    };
  });
  const imported = stored
    .filter((connector) => !connectorDefinitions.some((definition) => definition.id === connector.id))
    .map((connector) => ({
      id: connector.id,
      displayName: connector.displayNameOverride ?? connector.id,
      description: "Imported from an existing MCP config.",
      longDescription: "This connected app was imported from an MCP config you pasted into the admin agent.",
      authType: "custom" as const,
      requiredFields: [],
      permissionActions: [{ id: "use_tools", label: "Use connector actions", safeByDefault: true, toolNames: [`${connector.id}.*`] }],
      mcpServer: { transport: "stdio" as const },
      estimatedTools: connector.toolCount,
      available: true,
      enabled: connector.enabled,
      status: connector.status,
      toolCount: connector.toolCount,
      allowedTools: connector.allowedTools,
      lastError: connector.lastError,
      displayNameOverride: connector.displayNameOverride
    }));
  return [...defined, ...imported];
}

app.get("/api/state", async (_req, res) => {
  res.json({
    gatewayUrl: gatewayUrl(),
    advancedMode: loaded.config.gateway.advancedMode,
    status: "Running",
    space: loaded.config.spaces[0],
    connectors: mergedConnectors(),
    activity: await readRecentActivity(),
    installConfigs: await installConfigs(),
    generatedAdvancedConfig: generatedAdvancedConfig()
  });
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, status: "running" });
});

app.get("/api/servers", (_req, res) => {
  res.json({
    servers: serverPayload()
  });
});

app.post("/api/servers/register", async (req, res) => {
  const id = typeof req.body.id === "string" && req.body.id.trim() ? slugify(req.body.id) : "";
  if (!id) {
    res.status(400).json({ ok: false, message: "Server id is required." });
    return;
  }
  const mcpServer = parseMcpServer(req.body);
  const toolNames = Array.isArray(req.body.tools) ? req.body.tools.filter((tool: unknown) => typeof tool === "string") : [`${id}.use_tool`];
  upsertConnector(loaded.config, "default", {
    id,
    enabled: req.body.enabled !== false,
    status: "not_connected",
    toolCount: toolNames.length,
    allowedTools: toolNames,
    displayNameOverride: typeof req.body.name === "string" ? req.body.name : id,
    mcpServer
  });
  await saveConfig(loaded.config);
  res.json({ ok: true, servers: serverPayload(), capabilities: capabilityIndex(loaded.config) });
});

app.patch("/api/servers/:id", async (req, res) => {
  const connector = loaded.config.spaces[0].connectors.find((candidate) => candidate.id === req.params.id);
  if (!connector) {
    res.status(404).json({ ok: false, message: "Server not found." });
    return;
  }
  if (typeof req.body.enabled === "boolean") {
    connector.enabled = req.body.enabled;
  }
  await saveConfig(loaded.config);
  res.json({ ok: true, server: connector, capabilities: capabilityIndex(loaded.config) });
});

app.post("/api/servers/:id/test", async (req, res) => {
  const connector = loaded.config.spaces[0].connectors.find((candidate) => candidate.id === req.params.id);
  const mcpServer = connector?.mcpServer ?? getConnectorDefinition(req.params.id)?.mcpServer;
  if (!connector || !mcpServer) {
    res.status(404).json({ ok: false, message: "Server not found." });
    return;
  }
  try {
    if (mcpServer.url?.startsWith("mock://")) {
      connector.status = "connected";
      connector.lastError = undefined;
    } else {
      await testDownstreamServer(mcpServer);
      connector.status = "connected";
      connector.lastError = undefined;
    }
    await saveConfig(loaded.config);
    res.json({ ok: true, server: connector });
  } catch (error) {
    connector.status = "error";
    connector.lastError = error instanceof Error ? error.message : "Connection failed.";
    await saveConfig(loaded.config);
    res.status(400).json({ ok: false, message: connector.lastError, server: connector });
  }
});

app.post("/api/servers/:id/index", async (req, res) => {
  const connector = loaded.config.spaces[0].connectors.find((candidate) => candidate.id === req.params.id);
  const definition = getConnectorDefinition(req.params.id);
  if (!connector) {
    res.status(404).json({ ok: false, message: "Server not found." });
    return;
  }
  try {
    if (connector.mcpServer && !connector.mcpServer.url?.startsWith("mock://")) {
      const capabilities = await listDownstreamTools(connector.id, connector.displayNameOverride ?? connector.id, connector.mcpServer);
      connector.capabilities = capabilities;
      connector.allowedTools = capabilities.map((tool) => tool.name);
      connector.toolCount = capabilities.length;
      connector.status = "connected";
    } else {
      const toolNames = definition?.permissionActions.flatMap((action) => action.toolNames) ?? connector.allowedTools;
      connector.allowedTools = [...new Set(toolNames)];
      connector.toolCount = connector.allowedTools.length;
      connector.status = "connected";
    }
    connector.lastError = undefined;
    await saveConfig(loaded.config);
    res.json({ ok: true, server: connector, capabilities: capabilityIndex(loaded.config) });
  } catch (error) {
    connector.status = "error";
    connector.lastError = error instanceof Error ? error.message : "Index failed.";
    await saveConfig(loaded.config);
    res.status(400).json({ ok: false, message: connector.lastError, server: connector });
  }
});

app.get("/api/capabilities", (_req, res) => {
  res.json({ tools: capabilityIndex(loaded.config) });
});

app.get("/api/overview", async (_req, res) => {
  const approvals = await readApprovals();
  const audit = await readAudit(30);
  const tools = capabilityIndex(loaded.config);
  const pending = approvals.filter((approval) => approval.status === "pending");
  res.json({
    gatewayUrl: gatewayUrl(),
    servers: serverPayload(),
    tools,
    policies: await readPolicies(),
    approvals,
    audit,
    latest: audit[0] ?? null,
    metrics: {
      activeServers: loaded.config.spaces[0].connectors.filter((connector) => connector.enabled && connector.status === "connected").length,
      indexedTools: tools.length,
      pendingApprovals: pending.length,
      deniedCalls: audit.filter((entry) => entry.status === "denied").length,
      totalCalls: audit.length
    }
  });
});

app.get("/api/control-room", async (_req, res) => {
  res.json(await controlRoomPayload());
});

app.get("/api/token-cost-optimisations", async (_req, res) => {
  res.json({
    optimisations: await readTokenCostOptimisations(50)
  });
});

app.patch("/api/control-room/servers/:id/access", async (req, res) => {
  const connector = loaded.config.spaces[0].connectors.find((candidate) => candidate.id === req.params.id);
  if (!connector) {
    res.status(404).json({ ok: false, message: "Server not found." });
    return;
  }
  const serverTools = capabilityIndex(loaded.config).filter((tool) => tool.serverId === connector.id);
  const nextPolicies = updateServerAccessPolicies(await readPolicies(), serverTools, {
    global: normalizeUiDecision(req.body.global),
    globalProvided: Object.prototype.hasOwnProperty.call(req.body, "global"),
    teams: normalizeDecisionMap(req.body.teams),
    users: normalizeDecisionMap(req.body.users)
  });
  await replacePolicies(nextPolicies);
  res.json({ ok: true, controlRoom: await controlRoomPayload() });
});

app.get("/api/policies", async (_req, res) => {
  res.json({ policies: await readPolicies() });
});

app.put("/api/policies", async (req, res) => {
  const policies = Array.isArray(req.body.policies) ? req.body.policies : [];
  await replacePolicies(policies);
  res.json({ ok: true, policies: await readPolicies() });
});

app.post("/api/policies/reset", async (_req, res) => {
  await resetGovernanceState();
  res.json({ ok: true, policies: await readPolicies(), approvals: await readApprovals(), audit: await readAudit() });
});

app.get("/api/approvals", async (_req, res) => {
  res.json({ approvals: await readApprovals() });
});

app.post("/api/approvals/:id/reject", async (req, res) => {
  const decidedAt = new Date().toISOString();
  const approval = await updateApproval(req.params.id, {
    status: "rejected",
    decidedAt,
    decidedBy: typeof req.body.admin === "string" ? req.body.admin : "admin",
    reason: typeof req.body.reason === "string" ? req.body.reason : "Rejected by admin."
  });
  if (!approval) {
    res.status(404).json({ ok: false, message: "Approval not found." });
    return;
  }
  if (approval.tool === "gateway.install") {
    const profile = installProfileForApproval(approval.id);
    if (profile) {
      profile.approvalStatus = "rejected";
      profile.rejectedAt = decidedAt;
      profile.approvalId = approval.id;
      await saveConfig(loaded.config);
    }
  }
  await auditToolResult({ userId: approval.userId, teamId: approval.teamId }, approval.tool, approval.input, "rejected", ["approval:rejected"], undefined, approval.reason, approval.id);
  res.json({ ok: true, approval });
});

app.post("/api/approvals/:id/approve", async (req, res) => {
  const existing = (await readApprovals()).find((approval) => approval.id === req.params.id);
  if (!existing) {
    res.status(404).json({ ok: false, message: "Approval not found." });
    return;
  }
  if (existing.status !== "pending") {
    res.status(409).json({ ok: false, message: `Approval is already ${existing.status}.`, approval: existing });
    return;
  }
  if (existing.tool === "gateway.install") {
    const profile = installProfileForApproval(existing.id);
    if (!profile) {
      res.status(404).json({ ok: false, message: "Install profile not found for this approval." });
      return;
    }
    const decidedAt = new Date().toISOString();
    profile.approvalStatus = "active";
    profile.approvalId = existing.id;
    profile.approvedAt = decidedAt;
    profile.rejectedAt = undefined;
    await saveConfig(loaded.config);
    const result = { installProfileId: profile.id, status: profile.approvalStatus };
    const approval = await updateApproval(existing.id, {
      status: "approved",
      decidedAt,
      decidedBy: typeof req.body.admin === "string" ? req.body.admin : "admin",
      result
    });
    await auditToolResult({ userId: existing.userId, teamId: existing.teamId }, existing.tool, existing.input, "success", ["approval:approved", "install:active"], result, "MCP install approved. Gateway handshakes are now allowed.", existing.id);
    res.json({ ok: true, approval, result, controlRoom: await controlRoomPayload() });
    return;
  }
  try {
    const result = await executeApprovedTool(loaded.config, existing.tool, existing.input);
    const approval = await updateApproval(existing.id, {
      status: "approved",
      decidedAt: new Date().toISOString(),
      decidedBy: typeof req.body.admin === "string" ? req.body.admin : "admin",
      result
    });
    await auditToolResult({ userId: existing.userId, teamId: existing.teamId }, existing.tool, existing.input, "success", ["approval:approved", "execution:success"], result, "Executed after admin approval.", existing.id);
    res.json({ ok: true, approval, result });
  } catch (error) {
    await auditToolResult({ userId: existing.userId, teamId: existing.teamId }, existing.tool, existing.input, "error", ["approval:approved", "execution:error"], undefined, error instanceof Error ? error.message : "Execution failed.", existing.id);
    res.status(500).json({ ok: false, message: error instanceof Error ? error.message : "Execution failed." });
  }
});

app.post("/api/approvals/:id/tool-decisions", async (req, res) => {
  const existing = (await readApprovals()).find((approval) => approval.id === req.params.id);
  if (!existing) {
    res.status(404).json({ ok: false, message: "Approval not found." });
    return;
  }
  if (existing.status !== "pending") {
    res.status(409).json({ ok: false, message: `Approval is already ${existing.status}.`, approval: existing });
    return;
  }
  const decisions = normalizeToolDecisions(req.body.decisions);
  const requestedTools = existing.tool === "gateway.install"
    ? [{
        server: "gateway",
        tool: "gateway.install",
        reason: "Install approval is required before this MCP endpoint can expose tools.",
        flagReason: "Unapproved MCP install attempted to use the gateway.",
        currentPolicy: "require_approval" as const
      }]
    : existing.requestedTools?.length ? existing.requestedTools : clientPortalRequestedTools(existing.input);
  const missingDecision = requestedTools.find((tool) => !decisions[tool.tool]);
  if (missingDecision) {
    res.status(400).json({ ok: false, message: `Review ${missingDecision.tool} before submitting.` });
    return;
  }
  const decidedAt = new Date().toISOString();
  const results: Record<string, unknown> = {};
  let installDecision: "approved" | "rejected" | null = null;
  for (const tool of requestedTools) {
    const actor = { userId: existing.userId, teamId: existing.teamId };
    const input = tool.input ?? {};
    if (decisions[tool.tool] === "approve") {
      if (tool.tool === "gateway.install") {
        const activation = await activateInstallApproval(existing.id, existing);
        if (!activation.ok) {
          res.status(404).json({ ok: false, message: activation.message ?? "Install profile not found for this approval." });
          return;
        }
        installDecision = "approved";
        results[tool.tool] = activation.result;
        await auditToolResult(actor, tool.tool, input, "success", [`approval:${existing.id}:approved`, "install:active"], activation.result, "MCP install approved. Gateway handshakes are now allowed.", existing.id);
      } else {
        try {
          const result = await executeApprovedTool(loaded.config, tool.tool, input);
          results[tool.tool] = result;
          await auditToolResult(actor, tool.tool, input, "success", [`approval:${existing.id}:approved`, "execution:success"], result, "Approved in bundled workflow.", existing.id);
        } catch (error) {
          results[tool.tool] = { error: error instanceof Error ? error.message : "Execution failed." };
          await auditToolResult(actor, tool.tool, input, "error", [`approval:${existing.id}:approved`, "execution:error"], undefined, error instanceof Error ? error.message : "Execution failed.", existing.id);
        }
      }
    } else {
      if (tool.tool === "gateway.install") {
        const rejection = await rejectInstallApproval(existing.id, existing);
        if (!rejection.ok) {
          res.status(404).json({ ok: false, message: rejection.message ?? "Install profile not found for this approval." });
          return;
        }
        installDecision = "rejected";
        results[tool.tool] = rejection.result;
        await auditToolResult(actor, tool.tool, input, "rejected", [`approval:${existing.id}:denied`, "install:blocked"], undefined, "MCP install approval was denied.", existing.id);
        continue;
      }
      await auditToolResult(actor, tool.tool, input, "denied", [`approval:${existing.id}:denied`, "sensitive-data:blocked"], undefined, tool.flagReason, existing.id);
    }
  }
  const finalStatus = installDecision ?? "approved";
  const approval = await updateApproval(existing.id, {
    status: finalStatus,
    decidedAt,
    decidedBy: typeof req.body.admin === "string" ? req.body.admin : "admin",
    toolDecisions: decisions,
    result: results
  });
  res.json({ ok: true, approval, results, controlRoom: await controlRoomPayload() });
});

app.get("/api/audit", async (_req, res) => {
  res.json({ audit: await readAudit() });
});

app.post("/api/demo/reset", async (_req, res) => {
  loaded = await resetConfig();
  ownerInstallToken = loaded.apiKey;
  await saveSecret("install-profile:default:owner", { token: ownerInstallToken });
  await resetGovernanceState();
  await resetTokenCostOptimisations();
  res.json({ ok: true, token: ownerInstallToken, capabilities: capabilityIndex(loaded.config), policies: await readPolicies() });
});

app.post("/api/demo/run", async (req, res) => {
  const scenario = typeof req.body.scenario === "string" ? req.body.scenario : "brand-assets";
  const scenarios: Record<string, { userId: string; teamId: string; tool: string; input: Record<string, unknown> }> = {
    "brand-assets": { userId: "fred.haris", teamId: "users", tool: "brand_assets.get_brand_kit", input: { clientName: "Violet Labs", portalGoal: "Create a partner portal using approved brand assets." } },
    "hubspot-approval": { userId: "max.epstein", teamId: "users", tool: "hubspot.search_contacts", input: { query: "Violet Labs", properties: ["contacts", "companies", "deals"] } },
    "prod-denied": { userId: "liberty.jacobs", teamId: "users", tool: "prod_db.query", input: { sql: "select * from customer_portal_context where client_name = $1", params: ["Violet Labs"] } },
    "prod-approval": { userId: "hugh.thomas", teamId: "users", tool: "prod_db.query", input: { sql: "select * from customer_portal_context where client_name = $1", params: ["Violet Labs"] } }
  };
  const selected = scenarios[scenario] ?? scenarios["brand-assets"];
  const profile = loaded.config.spaces[0].installProfiles[0];
  const optimisation = await recordTokenCostOptimisation({
    appName: "demo-runner",
    toolName: selected.tool,
    args: selected.input
  });
  try {
    const result = await handleToolCall(loaded.config, selected.tool, selected.input, "demo-runner", profile, { userId: selected.userId, teamId: selected.teamId });
    res.json({ ok: true, scenario, result, optimisation, overview: await overviewPayload() });
  } catch (error) {
    res.status(200).json({ ok: false, scenario, message: error instanceof Error ? error.message : "Scenario failed.", optimisation, overview: await overviewPayload() });
  }
});

app.post("/api/agent/settings", async (req, res) => {
  const provider = req.body.provider === "anthropic" ? "anthropic" : "openai";
  const model = typeof req.body.model === "string" && req.body.model.trim() ? req.body.model.trim() : provider === "openai" ? "gpt-4.1-mini" : "claude-3-5-haiku-latest";
  const modelKey = typeof req.body.modelKey === "string" ? req.body.modelKey.trim() : "";
  if (modelKey) {
    await saveSecret("admin-agent:default", { provider, model, modelKey });
  }
  loaded.config.spaces[0].adminAgent = { provider, model, modelKeyStored: modelKey ? true : loaded.config.spaces[0].adminAgent.modelKeyStored };
  await saveConfig(loaded.config);
  res.json({ ok: true, adminAgent: loaded.config.spaces[0].adminAgent });
});

app.post("/api/agent/message", async (req, res) => {
  const message = typeof req.body.message === "string" ? req.body.message.trim() : "";
  if (!message) {
    res.status(400).json({ ok: false, message: "Tell the admin agent what you want to connect or import." });
    return;
  }
  const messages: AgentMessage[] = [{ role: "user", content: message, createdAt: new Date().toISOString() }];
  const deterministic = await handleDeterministicAgentAction(message);
  const llmText = deterministic.includes("Notion internal integration token") ? "" : await callAdminLlm(message);
  messages.push({
    role: "assistant",
    content: [deterministic, llmText].filter(Boolean).join("\n\n"),
    createdAt: new Date().toISOString()
  });
  res.json({ ok: true, messages, state: await statePayload() });
});

app.post("/api/import/mcp-config", async (req, res) => {
  const configText = typeof req.body.configText === "string" ? req.body.configText : "";
  const result = await importMcpConfig(configText);
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json({ ...result, state: await statePayload() });
});

app.post("/api/install-profiles", async (req, res) => {
  const name = typeof req.body.name === "string" && req.body.name.trim() ? req.body.name.trim() : "Teammate install";
  const { profile, token } = addInstallProfile(loaded.config.spaces[0], name);
  await saveSecret(`install-profile:default:${profile.id}`, { token });
  await saveConfig(loaded.config);
  res.json({ ok: true, profile, installConfigs: await installConfigs(profile.id), state: await statePayload() });
});

app.patch("/api/install-profiles/:id/permissions", async (req, res) => {
  const profile = loaded.config.spaces[0].installProfiles.find((candidate) => candidate.id === req.params.id);
  if (!profile) {
    res.status(404).json({ ok: false, message: "Install profile not found." });
    return;
  }
  profile.allowedTools = Array.isArray(req.body.allowedTools) ? req.body.allowedTools : profile.allowedTools;
  await saveConfig(loaded.config);
  res.json({ ok: true, profile, state: await statePayload() });
});

app.post("/api/install-profiles/:id/disconnect", async (req, res) => {
  const profile = loaded.config.spaces[0].installProfiles.find((candidate) => candidate.id === req.params.id);
  if (!profile) {
    res.status(404).json({ ok: false, message: "Install profile not found." });
    return;
  }
  profile.approvalStatus = "not_started";
  profile.approvalId = undefined;
  profile.approvedAt = undefined;
  profile.rejectedAt = undefined;
  profile.lastUsedAt = undefined;
  await saveConfig(loaded.config);
  await auditToolResult(
    { userId: typeof req.body.admin === "string" ? req.body.admin : "admin", teamId: "security" },
    "gateway.install",
    { installProfileId: profile.id, installProfileName: profile.name },
    "pending",
    ["install:reset"],
    undefined,
    "Install approval reset. The next MCP handshake must be approved again."
  );
  res.json({ ok: true, profile: installProfilePayload(profile), controlRoom: await controlRoomPayload() });
});

app.post("/api/connectors/:id/test", async (req, res) => {
  const definition = getConnectorDefinition(req.params.id);
  if (!definition || !definition.available) {
    res.status(400).json({ ok: false, message: "This connector is not available in the MVP yet." });
    return;
  }
  const credentials = req.body as Record<string, string>;
  const missing = definition.requiredFields.filter((field) => !credentials[field.key]?.trim());
  if (missing.length > 0) {
    res.status(400).json({ ok: false, message: `${missing[0].label} is required.` });
    return;
  }
  if (definition.id === "filesystem") {
    try {
      const folder = await stat(credentials.ROOT_PATH);
      if (!folder.isDirectory()) {
        res.status(400).json({ ok: false, message: "Connection failed. Choose a folder your assistant can access." });
        return;
      }
    } catch {
      res.status(400).json({ ok: false, message: "Connection failed. Choose a folder your assistant can access." });
      return;
    }
  }
  if (definition.id === "github") {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${credentials.GITHUB_TOKEN}`,
        "user-agent": "mcp-gateway-local"
      }
    });
    if (!response.ok) {
      res.status(400).json({ ok: false, message: "Connection failed. Your token may be invalid or missing permissions." });
      return;
    }
  }
  if (definition.id === "notion") {
    const response = await fetch("https://api.notion.com/v1/users/me", {
      headers: {
        authorization: `Bearer ${credentials.NOTION_TOKEN}`,
        "notion-version": "2022-06-28"
      }
    });
    if (!response.ok) {
      res.status(400).json({ ok: false, message: "Connection failed. Paste a valid Notion integration token and make sure pages are shared with that integration." });
      return;
    }
  }
  res.json({ ok: true, message: `Connected successfully. Found ${definition.estimatedTools || 1} available actions.` });
});

app.post("/api/connectors/:id/enable", async (req, res) => {
  const definition = getConnectorDefinition(req.params.id);
  if (!definition || !definition.available) {
    res.status(400).json({ ok: false, message: "This connector is not available in the MVP yet." });
    return;
  }
  const credentials = req.body as Record<string, string>;
  const allowedTools = definition.permissionActions
    .filter((action) => action.safeByDefault)
    .flatMap((action) => action.toolNames);
  await saveConnectorCredentials("default", definition.id, credentials);
  upsertConnector(loaded.config, "default", {
    id: definition.id,
    enabled: true,
    status: "connected",
    toolCount: definition.estimatedTools || 1,
    allowedTools,
    displayNameOverride: credentials.CONNECTOR_NAME
  });
  await saveConfig(loaded.config);
  res.json({ ok: true, state: { connectors: mergedConnectors(), space: loaded.config.spaces[0] } });
});

app.patch("/api/connectors/:id/permissions", async (req, res) => {
  const connector = loaded.config.spaces[0].connectors.find((candidate) => candidate.id === req.params.id);
  if (!connector) {
    res.status(404).json({ ok: false, message: "Connector not found." });
    return;
  }
  connector.allowedTools = Array.isArray(req.body.allowedTools) ? req.body.allowedTools : connector.allowedTools;
  await saveConfig(loaded.config);
  res.json({ ok: true, space: loaded.config.spaces[0], connectors: mergedConnectors() });
});

app.post("/api/settings/regenerate-key", async (_req, res) => {
  ownerInstallToken = createInstallToken();
  const ownerProfile = loaded.config.spaces[0].installProfiles.find((profile) => profile.id === "owner") ?? loaded.config.spaces[0].installProfiles[0];
  ownerProfile.tokenHash = hashApiKey(ownerInstallToken);
  ownerProfile.tokenPreview = previewApiKey(ownerInstallToken);
  ownerProfile.approvalStatus = "not_started";
  ownerProfile.approvalId = undefined;
  ownerProfile.approvedAt = undefined;
  ownerProfile.rejectedAt = undefined;
  ownerProfile.lastUsedAt = undefined;
  await saveSecret(`install-profile:default:${ownerProfile.id}`, { token: ownerInstallToken });
  await saveConfig(loaded.config);
  res.json({ ok: true, installConfigs: await installConfigs(ownerProfile.id) });
});

app.patch("/api/settings", async (req, res) => {
  loaded.config.gateway.advancedMode = Boolean(req.body.advancedMode);
  await saveConfig(loaded.config);
  res.json({ ok: true, advancedMode: loaded.config.gateway.advancedMode });
});

app.post("/api/reset", async (_req, res) => {
  loaded = await resetConfig();
  ownerInstallToken = loaded.apiKey;
  await saveSecret("install-profile:default:owner", { token: ownerInstallToken });
  await resetGovernanceState();
  await resetTokenCostOptimisations();
  res.json({ ok: true });
});

app.get("/api/export-config", async (_req, res) => {
  res.type("application/json").send(await readFile(process.env.MCP_GATEWAY_DATA_DIR ? join(process.env.MCP_GATEWAY_DATA_DIR, "gateway.json") : "data/gateway.json", "utf8"));
});

registerMcpEndpoint(app, () => loaded.config, {
  legacyToken: ownerInstallToken,
  onInstallUsed: async (profile) => {
    if (profile.approvalStatus === "active") {
      profile.lastUsedAt = new Date().toISOString();
      await saveConfig(loaded.config);
      return { allowed: true };
    }
    if (!profile.approvalId || profile.approvalStatus !== "pending") {
      const approval = await queueApproval(
        { userId: "external-mcp-app", teamId: "security" },
        "gateway.install",
        { installProfileId: profile.id, installProfileName: profile.name },
        ["install:approval-required"]
      );
      await updateApproval(approval.id, {
        requester: "External MCP app",
        requesterName: "External MCP app",
        requesterTeam: "security",
        source: "MCP Gateway",
        requestedServers: ["gateway"],
        requestedTools: [{
          server: "gateway",
          tool: "gateway.install",
          reason: "Install approval is required before this MCP endpoint can expose tools.",
          flagReason: "Unapproved MCP install attempted to use the gateway.",
          currentPolicy: "require_approval"
        }],
        summary: `${profile.name} is waiting for gateway approval.`
      });
      profile.approvalStatus = "pending";
      profile.approvalId = approval.id;
      profile.approvedAt = undefined;
      profile.rejectedAt = undefined;
      await saveConfig(loaded.config);
    }
    return {
      allowed: false,
      approvalId: profile.approvalId,
      message: "MCP install approval is required before this gateway can be used."
    };
  }
});

const publicDir = resolve("dist/public");
if (existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get(/.*/, (_req, res) => res.sendFile(join(publicDir, "index.html")));
}

app.listen(loaded.config.gateway.port, loaded.config.gateway.host, () => {
  console.log(`MCP Gateway running at http://localhost:${loaded.config.gateway.port}`);
});

async function statePayload() {
  return {
    gatewayUrl: gatewayUrl(),
    advancedMode: loaded.config.gateway.advancedMode,
    status: "Running",
    space: loaded.config.spaces[0],
    connectors: mergedConnectors(),
    activity: await readRecentActivity(),
    installConfigs: await installConfigs(),
    generatedAdvancedConfig: generatedAdvancedConfig()
  };
}

async function overviewPayload() {
  const approvals = await readApprovals();
  const audit = await readAudit(30);
  const tools = capabilityIndex(loaded.config);
  return {
    gatewayUrl: gatewayUrl(),
    servers: serverPayload(),
    tools,
    policies: await readPolicies(),
    approvals,
    audit,
    latest: audit[0] ?? null,
    metrics: {
      activeServers: loaded.config.spaces[0].connectors.filter((connector) => connector.enabled && connector.status === "connected").length,
      indexedTools: tools.length,
      pendingApprovals: approvals.filter((approval) => approval.status === "pending").length,
      deniedCalls: audit.filter((entry) => entry.status === "denied").length,
      totalCalls: audit.length
    }
  };
}

async function controlRoomPayload() {
  const audit = await readAudit(50);
  const approvals = await readApprovals();
  const tools = capabilityIndex(loaded.config);
  const policies = await readPolicies();
  const users = userPayload(audit, approvals, policies);
  const servers = controlRoomServers(tools, policies, users);
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  return {
    gatewayUrl: gatewayUrl(),
    stats: {
      servers: servers.filter((server) => server.status === "connected").length,
      tools: tools.length,
      pendingApprovals: pendingApprovals.length,
      totalCalls: audit.length
    },
    users,
    mcpServers: servers,
    pendingApprovals: pendingApprovals.map((approval) => approvalPayload(approval)),
    liveRequests: audit.slice(0, 6).map((entry) => liveRequestPayload(entry)),
    auditLogs: audit.map((entry) => ({
      id: entry.id,
      time: entry.timestamp,
      status: entry.status,
      user: entry.user,
      team: entry.team,
      tool: entry.tool,
      policy: entry.policyTrace.join(" > "),
      action: entry.reason ?? auditAction(entry.status)
    })),
    installConfigs: await installConfigs(),
    installProfiles: loaded.config.spaces[0].installProfiles.map((profile) => installProfilePayload(profile))
  };
}

type UiPolicyDecision = "allow" | "deny" | "require_approval" | "inherit";
type UserMap = Record<string, { id: string; name: string; email: string; color: string }>;

const defaultUsers: UserMap = {
  "fred.haris": {
    id: "fred.haris",
    name: "Fred Haris",
    email: "fred.haris@company.io",
    color: "#0447ff"
  },
  "max.epstein": {
    id: "max.epstein",
    name: "Max Epstein",
    email: "max.epstein@company.io",
    color: "#ff4704"
  },
  "liberty.jacobs": {
    id: "liberty.jacobs",
    name: "Liberty Jacobs",
    email: "liberty.jacobs@company.io",
    color: "#57534f"
  },
  "hugh.thomas": {
    id: "hugh.thomas",
    name: "Hugh Thomas",
    email: "hugh.thomas@company.io",
    color: "#000000"
  }
};

function controlRoomServers(tools: ToolCapability[], policies: PolicyRule[], users: UserMap) {
  return loaded.config.spaces[0].connectors.map((connector) => {
    const definition = getConnectorDefinition(connector.id);
    const serverTools = tools.filter((tool) => tool.serverId === connector.id);
    const access = serverAccessFromPolicies(serverTools, policies, users);
    return {
      id: connector.id,
      name: connector.displayNameOverride ?? definition?.displayName ?? connector.id,
      status: connector.status,
      enabled: connector.enabled,
      endpoint: connector.mcpServer?.url ?? connector.mcpServer?.command ?? definition?.mcpServer.url ?? definition?.mcpServer.command ?? "local mock",
      transport: connector.mcpServer?.transport ?? definition?.mcpServer.transport ?? "http",
      toolCount: serverTools.length || connector.toolCount,
      tools: serverTools.length ? serverTools.map((tool) => tool.name) : connector.allowedTools,
      global: access.global,
      teams: access.teams,
      users: access.users,
      lastError: connector.lastError
    };
  });
}

function userPayload(audit: AuditLogEntry[], approvals: ApprovalRequest[], policies: PolicyRule[]) {
  const users: UserMap = Object.fromEntries(Object.entries(defaultUsers).map(([id, user]) => [id, { ...user }]));
  for (const userId of new Set([
    ...audit.map((entry) => entry.user),
    ...approvals.map((approval) => approval.userId),
    ...policies.filter((policy) => policy.scope === "user").map((policy) => policy.subjectId)
  ].filter(Boolean))) {
    users[userId] ??= {
      id: userId,
      name: userId.split(".").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "),
      email: userId.includes("@") ? userId : `${userId}@company.io`,
      color: "#64748B"
    };
  }
  return users;
}

function serverAccessFromPolicies(serverTools: ToolCapability[], policies: PolicyRule[], users: UserMap) {
  const userSubjects = [
    ...new Set([
      ...Object.keys(users),
      ...policies.filter((policy) => policy.scope === "user").map((policy) => policy.subjectId)
    ])
  ];
  return {
    global: aggregateDecision(serverTools, policies, "global", "*", false),
    teams: {},
    users: Object.fromEntries(userSubjects.map((userId) => [userId, aggregateDecision(serverTools, policies, "user", userId, true)]))
  };
}

function aggregateDecision(serverTools: ToolCapability[], policies: PolicyRule[], scope: PolicyRule["scope"], subjectId: string, exactOnly: boolean): UiPolicyDecision {
  if (!serverTools.length) {
    return "inherit";
  }
  const decisions = serverTools.map((tool) => decisionForTool(policies, scope, subjectId, tool, exactOnly));
  const [first] = decisions;
  return first && decisions.every((decision) => decision === first) ? uiDecision(first) : "inherit";
}

function decisionForTool(policies: PolicyRule[], scope: PolicyRule["scope"], subjectId: string, tool: ToolCapability, exactOnly: boolean) {
  const exact = policies.find((policy) => policy.scope === scope && policy.subjectId === subjectId && policy.tool === tool.name);
  if (exact) {
    return exact.decision;
  }
  if (exactOnly) {
    return undefined;
  }
  return policies.find((policy) => policy.scope === scope && policy.subjectId === subjectId && !policy.tool && (!policy.classification || policy.classification === tool.classification))?.decision;
}

function updateServerAccessPolicies(policies: PolicyRule[], serverTools: ToolCapability[], access: { global?: PolicyDecision; globalProvided: boolean; teams: Record<string, PolicyDecision | undefined>; users: Record<string, PolicyDecision | undefined> }) {
  const toolNames = new Set(serverTools.map((tool) => tool.name));
  const teamSubjects = new Set(Object.keys(access.teams));
  const userSubjects = new Set(Object.keys(access.users));
  const retained = policies.filter((policy) => {
    if (!policy.tool || !toolNames.has(policy.tool)) {
      return true;
    }
    if (policy.scope === "global" && policy.subjectId === "*" && access.globalProvided) {
      return false;
    }
    if (policy.scope === "team" && teamSubjects.has(policy.subjectId)) {
      return false;
    }
    if (policy.scope === "user" && userSubjects.has(policy.subjectId)) {
      return false;
    }
    return true;
  });
  const next = [...retained];
  const globalDecision = access.global;
  if (globalDecision) {
    next.push(...serverTools.map((tool) => accessRule("global", "*", tool.name, globalDecision)));
  }
  for (const [teamId, decision] of Object.entries(access.teams)) {
    if (decision) {
      next.push(...serverTools.map((tool) => accessRule("team", teamId, tool.name, decision)));
    }
  }
  for (const [userId, decision] of Object.entries(access.users)) {
    if (decision) {
      next.push(...serverTools.map((tool) => accessRule("user", userId, tool.name, decision)));
    }
  }
  return next;
}

function accessRule(scope: PolicyRule["scope"], subjectId: string, tool: string, decision: PolicyDecision): PolicyRule {
  return {
    id: `${scope}-${subjectId}-${tool}-${decision}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase(),
    scope,
    subjectId,
    tool,
    decision,
    reason: `${scope} policy ${decision} for ${tool}.`
  };
}

function normalizeUiDecision(value: unknown): PolicyDecision | undefined {
  if (value === "allow" || value === "deny" || value === "approval") {
    return value;
  }
  if (value === "require_approval") {
    return "approval";
  }
  return undefined;
}

function normalizeDecisionMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).map(([key, decision]) => [key, normalizeUiDecision(decision)]));
}

function normalizeToolDecisions(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, "approve" | "deny"] => entry[1] === "approve" || entry[1] === "deny"));
}

function uiDecision(decision: PolicyDecision): Exclude<UiPolicyDecision, "inherit"> {
  return decision === "approval" ? "require_approval" : decision;
}

function approvalPayload(approval: ApprovalRequest) {
  if (approval.tool === "gateway.install") {
    return {
      ...approval,
      requester: approval.requester ?? "External MCP app",
      requesterName: approval.requesterName ?? "External MCP app",
      requesterTeam: approval.requesterTeam ?? "security",
      source: approval.source ?? "MCP Gateway",
      timestamp: approval.createdAt,
      requestedServers: ["gateway"],
      requestedTools: [{
        server: "gateway",
        tool: "gateway.install",
        reason: "Install approval is required before this MCP endpoint can expose tools.",
        flagReason: "Unapproved MCP install attempted to use the gateway.",
        currentPolicy: "require_approval"
      }],
      summary: `${String(approval.input.installProfileName ?? "MCP install")} is waiting for gateway approval.`,
      toolApprovals: {}
    };
  }
  const server = approval.tool.split(".")[0] || "mcp";
  return {
    ...approval,
    requester: approval.requester ?? approval.userId,
    requesterName: approval.requesterName ?? approval.userId,
    requesterTeam: approval.requesterTeam ?? approval.teamId,
    source: approval.source ?? "MCP Gateway",
    timestamp: approval.createdAt,
    requestedServers: approval.requestedServers ?? [server],
    requestedTools: approval.requestedTools ?? [{
      server,
      tool: approval.tool,
      reason: approval.reason ?? "Policy requires approval.",
      flagReason: approval.reason ?? "Policy requires approval.",
      currentPolicy: "require_approval"
    }],
    summary: approval.summary ?? `${approval.userId} requested ${approval.tool}.`,
    toolApprovals: {}
  };
}

function installProfilePayload(profile: InstallProfile) {
  return {
    id: profile.id,
    name: profile.name,
    tokenPreview: profile.tokenPreview,
    allowedTools: profile.allowedTools,
    createdAt: profile.createdAt,
    lastUsedAt: profile.lastUsedAt,
    approvalStatus: profile.approvalStatus ?? "not_started",
    approvalId: profile.approvalId,
    approvedAt: profile.approvedAt,
    rejectedAt: profile.rejectedAt
  };
}

function installProfileForApproval(approvalId: string) {
  return loaded.config.spaces[0].installProfiles.find((profile) => profile.approvalId === approvalId);
}

async function activateInstallApproval(approvalId: string, approval?: ApprovalRequest) {
  const profile = installProfileForApproval(approvalId);
  if (!profile) {
    return { ok: false as const, message: "Install profile not found for this approval." };
  }
  const decidedAt = new Date().toISOString();
  profile.approvalStatus = "active";
  profile.approvalId = approvalId;
  profile.approvedAt = decidedAt;
  profile.rejectedAt = undefined;
  await saveConfig(loaded.config);
  if (approval) {
    await updateApproval(approval.id, {
      status: "approved",
      decidedAt,
      result: { installProfileId: profile.id, status: profile.approvalStatus }
    });
  }
  return {
    ok: true as const,
    result: { installProfileId: profile.id, status: profile.approvalStatus }
  };
}

async function rejectInstallApproval(approvalId: string, approval?: ApprovalRequest) {
  const profile = installProfileForApproval(approvalId);
  if (!profile) {
    return { ok: false as const, message: "Install profile not found for this approval." };
  }
  const decidedAt = new Date().toISOString();
  profile.approvalStatus = "rejected";
  profile.approvalId = approvalId;
  profile.rejectedAt = decidedAt;
  await saveConfig(loaded.config);
  if (approval) {
    await updateApproval(approval.id, {
      status: "rejected",
      decidedAt,
      result: { installProfileId: profile.id, status: profile.approvalStatus }
    });
  }
  return {
    ok: true as const,
    result: { installProfileId: profile.id, status: profile.approvalStatus }
  };
}

function liveRequestPayload(entry: AuditLogEntry) {
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    tool: entry.tool,
    user: entry.user,
    team: entry.team,
    status: entry.status === "success" ? "allowed" : entry.status,
    globalPolicy: traceDecision(entry.policyTrace, "global"),
    teamPolicy: traceDecision(entry.policyTrace, "team"),
    userPolicy: traceDecision(entry.policyTrace, "user"),
    params: entry.input,
    policyTrace: entry.policyTrace
  };
}

function traceDecision(trace: string[], scope: string): UiPolicyDecision {
  const segment = trace.find((item) => item.startsWith(`${scope}:`));
  if (!segment || segment.includes("no-")) {
    return "inherit";
  }
  return uiDecision((segment.split(":").at(-1) ?? "deny") as PolicyDecision);
}

function auditAction(status: AuditLogEntry["status"]) {
  if (status === "success") return "Executed MCP tool";
  if (status === "pending") return "Awaiting approval";
  if (status === "denied") return "Policy denied request";
  if (status === "rejected") return "Admin rejected request";
  return "Execution failed";
}

function serverPayload() {
  const tools = capabilityIndex(loaded.config);
  return loaded.config.spaces[0].connectors.map((connector) => {
    const definition = getConnectorDefinition(connector.id);
    const serverTools = tools.filter((tool) => tool.serverId === connector.id);
    return {
      id: connector.id,
      name: connector.displayNameOverride ?? definition?.displayName ?? connector.id,
      enabled: connector.enabled,
      status: connector.status,
      toolCount: connector.toolCount,
      tools: serverTools.map((tool) => tool.name),
      endpoint: connector.mcpServer?.url ?? connector.mcpServer?.command ?? definition?.mcpServer.url ?? definition?.mcpServer.command ?? "local mock",
      transport: connector.mcpServer?.transport ?? definition?.mcpServer.transport ?? "http",
      url: connector.mcpServer?.url ?? definition?.mcpServer.url,
      command: connector.mcpServer?.command ?? definition?.mcpServer.command,
      lastError: connector.lastError,
      demoFixture: connector.mcpServer?.url?.startsWith("mock://") || definition?.mcpServer.url?.startsWith("mock://") || ["github", "notion", "gmail"].includes(connector.id)
    };
  });
}

function parseMcpServer(body: Record<string, unknown>): McpServerDefinition {
  const transport = body.transport === "stdio" ? "stdio" : "http";
  if (transport === "stdio") {
    return {
      transport,
      command: typeof body.command === "string" ? body.command.trim() : "",
      args: parseLines(body.args),
      envMapping: parseKeyValueLines(body.env)
    };
  }
  return {
    transport,
    url: typeof body.url === "string" ? body.url.trim() : "",
    headers: parseKeyValueLines(body.headers)
  };
}

function parseLines(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  }
  if (typeof value !== "string") {
    return [];
  }
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function parseKeyValueLines(value: unknown) {
  const entries = parseLines(value);
  return Object.fromEntries(entries.map((entry) => {
    const index = entry.indexOf("=");
    return index >= 0 ? [entry.slice(0, index).trim(), entry.slice(index + 1).trim()] : [entry.trim(), ""];
  }));
}

async function ensureOwnerInstallToken() {
  const ownerProfile = loaded.config.spaces[0].installProfiles.find((profile) => profile.id === "owner") ?? loaded.config.spaces[0].installProfiles[0];
  const existing = await getSecret(`install-profile:default:${ownerProfile.id}`);
  if (existing.token) {
    return existing.token;
  }
  const token = loaded.apiKey || process.env.MCP_GATEWAY_API_KEY || createInstallToken();
  ownerProfile.tokenHash = hashApiKey(token);
  ownerProfile.tokenPreview = previewApiKey(token);
  await saveSecret(`install-profile:default:${ownerProfile.id}`, { token });
  await saveConfig(loaded.config);
  return token;
}

async function getInstallToken(profileId: string) {
  const profile = loaded.config.spaces[0].installProfiles.find((candidate) => candidate.id === profileId) ?? loaded.config.spaces[0].installProfiles[0];
  const secret = await getSecret(`install-profile:default:${profile.id}`);
  if (secret.token) {
    return secret.token;
  }
  if (profile.id === "owner") {
    return ownerInstallToken;
  }
  const token = createInstallToken();
  profile.tokenHash = hashApiKey(token);
  profile.tokenPreview = previewApiKey(token);
  await saveSecret(`install-profile:default:${profile.id}`, { token });
  await saveConfig(loaded.config);
  return token;
}

async function handleDeterministicAgentAction(message: string) {
  if (message.includes("\"mcpServers\"")) {
    const result = await importMcpConfig(message);
    if (result.ok) {
      return `Imported ${result.importedCount} MCP server${result.importedCount === 1 ? "" : "s"} into your Org MCP. I added safe shared-tool access and generated updated install configs.`;
    }
    return result.message;
  }
  const normalized = message.toLowerCase();
  if (normalized.includes("github")) {
    return "I can connect GitHub. Open Connected Apps, choose GitHub, paste a token, and I will test it and add safe read actions by default.";
  }
  if (normalized.includes("notion")) {
    return [
      "For the fastest Notion proof of concept, use Connected Apps -> Notion and paste a Notion internal integration token.",
      "In Notion, create an internal integration, copy its token, then open the pages or databases you want available and share them with that integration.",
      "After I test the token, this Org MCP exposes Notion actions through one install config you can paste into Lovable, Cursor, Claude, Codex, or another environment.",
      "If you paste Notion's official remote MCP config, I can import it too, but Notion's hosted MCP still requires a human OAuth login in the target client."
    ].join("\n");
  }
  if (normalized.includes("install") || normalized.includes("lovable") || normalized.includes("cursor") || normalized.includes("claude") || normalized.includes("codex")) {
    return "Your Org MCP install config is ready. Use the install buttons to copy it into Lovable, Cursor, Claude, Codex, or any environment that accepts an MCP server config.";
  }
  if (normalized.includes("filesystem") || normalized.includes("folder")) {
    return "I can connect a local folder. Open Connected Apps, choose Filesystem, and pick the folder path you want this Org MCP to expose.";
  }
  if (normalized.includes("share") || normalized.includes("team") || normalized.includes("teammate")) {
    const { profile, token } = addInstallProfile(loaded.config.spaces[0], "Teammate install");
    await saveSecret(`install-profile:default:${profile.id}`, { token });
    await saveConfig(loaded.config);
    return `Created a teammate install profile named "${profile.name}". Its config is available on Shared Installs.`;
  }
  return "I can import existing MCP configs, connect apps, generate install configs, create teammate installs, and tune shared-tool permissions.";
}

async function callAdminLlm(message: string) {
  const agent = loaded.config.spaces[0].adminAgent;
  if (!agent.modelKeyStored) {
    return "Add a model key to let the AI admin agent reason through less structured setup requests. Deterministic admin actions still work without it.";
  }
  const secret = await getSecret("admin-agent:default");
  if (!secret.modelKey) {
    return "";
  }
  try {
    if (agent.provider === "anthropic") {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": secret.modelKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: agent.model,
          max_tokens: 350,
          messages: [{ role: "user", content: adminPrompt(message) }]
        })
      });
      const body = await response.json();
      return response.ok ? body.content?.map((part: { text?: string }) => part.text).filter(Boolean).join("\n") ?? "" : "";
    }
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret.modelKey}`
      },
      body: JSON.stringify({
        model: agent.model,
        messages: [{ role: "user", content: adminPrompt(message) }],
        temperature: 0.2
      })
    });
    const body = await response.json();
    return response.ok ? body.choices?.[0]?.message?.content ?? "" : "";
  } catch {
    return "";
  }
}

function adminPrompt(message: string) {
  return `You are the MCP Gateway admin agent. Use non-technical language. Explain the next best action for this local-first Org MCP setup request. Do not reveal hidden install tokens. For Notion, do not claim this app has a Notion OAuth login; say the fastest local proof of concept uses a pasted Notion internal integration token, and official hosted Notion MCP uses OAuth in the target client.\n\nUser: ${message}`;
}

async function importMcpConfig(configText: string): Promise<{ ok: true; importedCount: number } | { ok: false; message: string }> {
  let parsed: unknown;
  try {
    const start = configText.indexOf("{");
    const end = configText.lastIndexOf("}");
    const jsonText = start >= 0 && end > start ? configText.slice(start, end + 1) : configText;
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, message: "I could not read that MCP config. Paste valid JSON with an mcpServers object." };
  }
  if (!isMcpConfig(parsed)) {
    return { ok: false, message: "That JSON does not include an mcpServers object I can import." };
  }
  let importedCount = 0;
  for (const [name, server] of Object.entries(parsed.mcpServers)) {
    const id = uniqueConnectorId(`imported-${slugify(name)}`);
    const allowedTools = [`${id}.*`];
    const connector: StoredConnector = {
      id,
      enabled: true,
      status: "connected",
      toolCount: 1,
      allowedTools,
      displayNameOverride: name
    };
    upsertConnector(loaded.config, "default", connector);
    loaded.config.spaces[0].importedMcpServers.push({
      id,
      name,
      sourceClient: "universal",
      importedAt: new Date().toISOString(),
      toolPrefix: id
    });
    await saveSecret(`connector:default:${id}`, { server: JSON.stringify(server) });
    importedCount += 1;
  }
  await saveConfig(loaded.config);
  return { ok: true, importedCount };
}

function isMcpConfig(value: unknown): value is { mcpServers: Record<string, McpServerDefinition> } {
  return Boolean(value && typeof value === "object" && "mcpServers" in value && typeof (value as { mcpServers: unknown }).mcpServers === "object");
}

function uniqueConnectorId(base: string) {
  const used = new Set(loaded.config.spaces[0].connectors.map((connector) => connector.id));
  if (!used.has(base)) {
    return base;
  }
  let index = 2;
  while (used.has(`${base}-${index}`)) {
    index += 1;
  }
  return `${base}-${index}`;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "mcp";
}
