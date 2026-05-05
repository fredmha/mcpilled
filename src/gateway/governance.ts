import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { nanoid } from "nanoid";
import type { ApprovalRequest, ApprovalRequestedTool, AuditLogEntry, AuditStatus, GatewayConfig, PolicyDecision, PolicyRule, ToolCapability, ToolClass } from "../shared/types.js";
import { connectorDefinitions } from "../connectors/registry.js";

const DATA_DIR = process.env.MCP_GATEWAY_DATA_DIR ?? "data";
const approvalsPath = join(DATA_DIR, "approvals.json");
const policiesPath = join(DATA_DIR, "policies.json");
const auditPath = join(DATA_DIR, "audit.jsonl");

export interface ActorContext {
  userId: string;
  teamId: string;
}

export interface PolicyEvaluation {
  decision: PolicyDecision;
  trace: string[];
  matchedRule: PolicyRule;
}

const defaultPolicies: PolicyRule[] = [
  {
    id: "global-read-allow",
    scope: "global",
    subjectId: "*",
    classification: "read",
    decision: "allow",
    reason: "Global policy allows read tools."
  },
  {
    id: "global-write-approval",
    scope: "global",
    subjectId: "*",
    classification: "write",
    decision: "approval",
    reason: "Global policy requires approval for write tools."
  },
  {
    id: "user-fred-haris-allow-brand-assets",
    scope: "user",
    subjectId: "fred.haris",
    tool: "brand_assets.get_brand_kit",
    decision: "allow",
    reason: "Fred Haris can use approved brand context."
  },
  {
    id: "user-max-epstein-approval-hubspot",
    scope: "user",
    subjectId: "max.epstein",
    tool: "hubspot.search_contacts",
    decision: "approval",
    reason: "Max Epstein needs approval before reading CRM data."
  },
  {
    id: "user-liberty-jacobs-deny-prod-db",
    scope: "user",
    subjectId: "liberty.jacobs",
    tool: "prod_db.query",
    decision: "deny",
    reason: "Liberty Jacobs cannot query production data."
  },
  {
    id: "user-hugh-thomas-approval-prod-db",
    scope: "user",
    subjectId: "hugh.thomas",
    tool: "prod_db.query",
    decision: "approval",
    reason: "Hugh Thomas needs approval before querying production data."
  },
  {
    id: "user-hugh-thomas-allow-brand-assets",
    scope: "user",
    subjectId: "hugh.thomas",
    tool: "brand_assets.list_assets",
    decision: "allow",
    reason: "Hugh Thomas can list approved brand assets."
  }
];

export function capabilityIndex(config: GatewayConfig): ToolCapability[] {
  const space = config.spaces[0];
  return space.connectors
    .filter((connector) => connector.enabled && connector.status === "connected")
    .flatMap((connector) => {
      if (connector.capabilities?.length) {
        return connector.capabilities.filter((tool) => connector.allowedTools.includes(tool.name) || connector.allowedTools.includes(`${connector.id}.*`));
      }
      const definition = connectorDefinitions.find((candidate) => candidate.id === connector.id);
      const toolNames = definition?.permissionActions.flatMap((action) => action.toolNames) ?? connector.allowedTools;
      return [...new Set(toolNames)]
        .filter((tool) => connector.allowedTools.includes(tool) || connector.allowedTools.includes(`${connector.id}.*`))
        .map((tool) => ({
          name: tool,
          description: `${definition?.displayName ?? connector.displayNameOverride ?? connector.id}: ${tool.split(".").slice(1).join(" ")}`,
          serverId: connector.id,
          serverName: connector.displayNameOverride ?? definition?.displayName ?? connector.id,
          classification: classifyTool(tool)
        }));
    });
}

export function classifyTool(toolName: string): ToolClass {
  const action = toolName.split(".").slice(1).join(".");
  return /(^|_)(create|write|update|delete|send|move|archive|insert|patch)/i.test(action) ? "write" : "read";
}

export async function readPolicies() {
  await ensurePolicies();
  return JSON.parse(await readFile(policiesPath, "utf8")) as PolicyRule[];
}

export async function replacePolicies(policies: PolicyRule[]) {
  await mkdir(dirname(policiesPath), { recursive: true });
  await writeFile(policiesPath, `${JSON.stringify(policies, null, 2)}\n`);
}

export async function resetGovernanceState() {
  await replacePolicies(defaultPolicies);
  await writeFile(approvalsPath, "[]\n");
  await writeFile(auditPath, "");
}

export async function evaluatePolicy(actor: ActorContext, toolName: string): Promise<PolicyEvaluation> {
  const policies = await readPolicies();
  const toolClass = classifyTool(toolName);
  const trace: string[] = [];
  const globalRule = bestRule(policies, "global", "*", toolName, toolClass);
  let selected = globalRule;
  trace.push(globalRule ? `global:${globalRule.id}:${globalRule.decision}` : "global:no-match:deny");

  const teamRule = bestRule(policies, "team", actor.teamId, toolName, toolClass);
  if (teamRule) {
    selected = teamRule;
    trace.push(`team:${teamRule.id}:${teamRule.decision}`);
  } else {
    trace.push("team:no-override");
  }

  const userRule = bestRule(policies, "user", actor.userId, toolName, toolClass);
  if (userRule) {
    selected = userRule;
    trace.push(`user:${userRule.id}:${userRule.decision}`);
  } else {
    trace.push("user:no-override");
  }

  const fallback: PolicyRule = {
    id: "implicit-deny",
    scope: "global",
    subjectId: "*",
    tool: toolName,
    decision: "deny",
    reason: "No matching policy allowed this tool."
  };
  const matchedRule = selected ?? fallback;
  return { decision: matchedRule.decision, trace, matchedRule };
}

function bestRule(policies: PolicyRule[], scope: PolicyRule["scope"], subjectId: string, toolName: string, toolClass: ToolClass) {
  return policies.find((rule) => matches(rule, scope, subjectId, toolName, toolClass, true))
    ?? policies.find((rule) => matches(rule, scope, subjectId, toolName, toolClass, false));
}

function matches(rule: PolicyRule, scope: PolicyRule["scope"], subjectId: string, toolName: string, toolClass: ToolClass, exactTool: boolean) {
  if (rule.scope !== scope || rule.subjectId !== subjectId) {
    return false;
  }
  if (exactTool) {
    return rule.tool === toolName;
  }
  return !rule.tool && (!rule.classification || rule.classification === toolClass);
}

export async function queueApproval(actor: ActorContext, tool: string, input: Record<string, unknown>, trace: string[]) {
  const approvals = await readApprovals();
  const request: ApprovalRequest = {
    id: nanoid(),
    userId: actor.userId,
    teamId: actor.teamId,
    tool,
    input,
    status: "pending",
    createdAt: new Date().toISOString()
  };
  approvals.push(request);
  await writeApprovals(approvals);
  await writeAudit({
    user: actor.userId,
    team: actor.teamId,
    tool,
    input,
    status: "pending",
    policyTrace: trace,
    approvalId: request.id,
    reason: "Queued for admin approval."
  });
  return request;
}

export async function queueWorkflowApproval(actor: ActorContext, input: Record<string, unknown>, requestedTools: ApprovalRequestedTool[], trace: string[]) {
  const approvals = await readApprovals();
  const clientName = typeof input.clientName === "string" && input.clientName.trim() ? input.clientName.trim() : "Acme Health";
  const request: ApprovalRequest = {
    id: nanoid(),
    userId: actor.userId,
    teamId: actor.teamId,
    requester: actor.userId.includes("@") ? actor.userId : `${actor.userId}@company.io`,
    requesterName: actor.userId.split(".").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "),
    requesterTeam: "Users",
    source: "Lovable",
    tool: "client_portal.create",
    input,
    status: "pending",
    createdAt: new Date().toISOString(),
    requestedServers: [...new Set(requestedTools.map((tool) => tool.server))],
    requestedTools,
    summary: `Lovable wants to create a custom client portal for ${clientName} using HubSpot, Spabase Prod, and Brand Assets.`
  };
  approvals.push(request);
  await writeApprovals(approvals);
  await writeAudit({
    user: actor.userId,
    team: actor.teamId,
    tool: request.tool,
    input,
    status: "pending",
    policyTrace: trace,
    approvalId: request.id,
    reason: "Queued bundled approval for HubSpot, Spabase Prod, and Brand Assets."
  });
  return request;
}

export async function readApprovals() {
  try {
    return JSON.parse(await readFile(approvalsPath, "utf8")) as ApprovalRequest[];
  } catch {
    await mkdir(dirname(approvalsPath), { recursive: true });
    await writeFile(approvalsPath, "[]\n");
    return [];
  }
}

export async function updateApproval(id: string, update: Partial<ApprovalRequest>) {
  const approvals = await readApprovals();
  const index = approvals.findIndex((approval) => approval.id === id);
  if (index < 0) {
    return null;
  }
  approvals[index] = { ...approvals[index], ...update };
  await writeApprovals(approvals);
  return approvals[index];
}

async function writeApprovals(approvals: ApprovalRequest[]) {
  await mkdir(dirname(approvalsPath), { recursive: true });
  await writeFile(approvalsPath, `${JSON.stringify(approvals, null, 2)}\n`);
}

export async function writeAudit(entry: Omit<AuditLogEntry, "id" | "timestamp">) {
  await mkdir(dirname(auditPath), { recursive: true });
  const payload: AuditLogEntry = {
    id: nanoid(),
    timestamp: new Date().toISOString(),
    ...entry
  };
  await appendFile(auditPath, `${JSON.stringify(payload)}\n`);
  return payload;
}

export async function readAudit(limit = 100) {
  try {
    const lines = (await readFile(auditPath, "utf8")).trim().split("\n").filter(Boolean);
    return lines.slice(-limit).reverse().map((line) => JSON.parse(line) as AuditLogEntry);
  } catch {
    return [];
  }
}

export async function auditToolResult(actor: ActorContext, tool: string, input: Record<string, unknown>, status: AuditStatus, trace: string[], output?: unknown, reason?: string, approvalId?: string) {
  return writeAudit({
    user: actor.userId,
    team: actor.teamId,
    tool,
    input,
    status,
    policyTrace: trace,
    output,
    reason,
    approvalId
  });
}

async function ensurePolicies() {
  try {
    const existing = JSON.parse(await readFile(policiesPath, "utf8")) as PolicyRule[];
    const validTools = new Set(["hubspot.search_contacts", "brand_assets.get_brand_kit", "brand_assets.list_assets", "prod_db.query"]);
    const retained = existing.filter((policy) => policy.scope !== "team" && (!policy.tool || validTools.has(policy.tool)));
    const existingIds = new Set(retained.map((policy) => policy.id));
    const missing = defaultPolicies.filter((policy) => !existingIds.has(policy.id));
    if (missing.length > 0 || retained.length !== existing.length) {
      await replacePolicies([...retained, ...missing]);
    }
  } catch {
    await replacePolicies(defaultPolicies);
  }
}
