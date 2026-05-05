import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { nanoid } from "nanoid";

const DATA_DIR = process.env.MCP_GATEWAY_DATA_DIR ?? "data";
const tracesPath = join(DATA_DIR, "token-cost-optimisations.json");
const ALLOWED_TRACE_TOOLS = new Set(["supabase.query", "hubspot.search_contacts", "brand_assets.get_brand_kit", "brand_assets.list_assets"]);

interface ContextCandidate {
  id: string;
  title: string;
  path: string;
  tokenCount: number;
  reason: string;
  removedReason: string;
}

interface ContextTraceItem {
  id: string;
  title: string;
  path: string;
  tokenCount: number;
  reason: string;
}

export interface TokenCostOptimisationTrace {
  id: string;
  createdAt: string;
  appName: string;
  toolName: string;
  requestSummary: string;
  indexedFiles: number;
  selectedFiles: ContextTraceItem[];
  removedFiles: ContextTraceItem[];
  ignoredFiles: number;
  naiveTokens: number;
  optimisedTokens: number;
  tokenReductionPercent: number;
  status: "optimised";
}

export async function recordTokenCostOptimisation(input: {
  appName: string;
  toolName: string;
  args: Record<string, unknown>;
}): Promise<TokenCostOptimisationTrace> {
  const traces = await readRawTokenCostOptimisations(100);
  const toolName = demoToolName(input.toolName);
  const seed = hashSeed(`${input.appName}:${toolName}:${JSON.stringify(input.args)}:${traces.length}`);
  const rand = seededRandom(seed);
  const candidates = shuffle(contextCandidates(toolName, input.args), rand);
  const selectedCount = 1 + Math.floor(rand() * 4);
  const indexedFiles = 4 + Math.floor(rand() * 15);
  const targetReduction = 0.45 + rand() * 0.37;
  const indexedTokens = 800 + Math.floor(rand() * 4001);
  const selectedTokens = clamp(Math.round(indexedTokens * (1 - targetReduction)), 180, 1200);
  const tokenReductionPercent = Number(((1 - selectedTokens / indexedTokens) * 100).toFixed(1));

  const selectedCandidates = candidates.slice(0, selectedCount);
  const removedCandidates = candidates.slice(selectedCount, selectedCount + Math.min(4, Math.max(2, indexedFiles - selectedCount)));
  const selectedFiles = distributeTokens(selectedCandidates, selectedTokens, "selected", rand);
  const removedBudget = indexedTokens - selectedTokens;
  const removedFiles = distributeTokens(removedCandidates, Math.max(removedBudget, removedCandidates.length * 90), "removed", rand);

  const trace: TokenCostOptimisationTrace = {
    id: nanoid(),
    createdAt: new Date().toISOString(),
    appName: input.appName,
    toolName,
    requestSummary: summariseRequest(toolName, input.args),
    indexedFiles,
    selectedFiles,
    removedFiles,
    ignoredFiles: Math.max(0, indexedFiles - selectedFiles.length),
    naiveTokens: indexedTokens,
    optimisedTokens: selectedTokens,
    tokenReductionPercent,
    status: "optimised"
  };

  await writeTraces([trace, ...traces].filter(isDemoTrace).slice(0, 100));
  return trace;
}

export async function readTokenCostOptimisations(limit = 50): Promise<TokenCostOptimisationTrace[]> {
  const traces = await readRawTokenCostOptimisations(100);
  return traces.filter(isDemoTrace).slice(0, limit);
}

export async function resetTokenCostOptimisations() {
  await writeTraces([]);
}

async function readRawTokenCostOptimisations(limit = 50): Promise<TokenCostOptimisationTrace[]> {
  try {
    const raw = await readFile(tracesPath, "utf8");
    const traces = JSON.parse(raw) as TokenCostOptimisationTrace[];
    return traces.slice(0, limit);
  } catch {
    return [];
  }
}

async function writeTraces(traces: TokenCostOptimisationTrace[]) {
  await mkdir(dirname(tracesPath), { recursive: true });
  await writeFile(tracesPath, `${JSON.stringify(traces, null, 2)}\n`);
}

function contextCandidates(toolName: string, args: Record<string, unknown>): ContextCandidate[] {
  const clientName = typeof args.clientName === "string" ? args.clientName : typeof args.query === "string" ? args.query : "Violet Labs";
  if (toolName === "supabase.query") {
    return [
      { id: "portal-usage", title: "Portal usage summary", path: "supabase.customer_portal_usage", tokenCount: 520, reason: "Directly supports account usage context for the MCP request.", removedReason: "Older aggregate replaced by current customer slice." },
      { id: "account-health", title: "Account health row", path: "supabase.account_health", tokenCount: 430, reason: "Small, high-signal customer health snapshot.", removedReason: "Health metric is unrelated to this read path." },
      { id: "schema-note", title: "Query schema note", path: "supabase.schema.customer_portal_context", tokenCount: 260, reason: "Keeps the agent aligned to the allowed query shape.", removedReason: "Schema detail is redundant after payload construction." },
      { id: "billing-rollup", title: "Billing rollup", path: "supabase.billing_rollup", tokenCount: 610, reason: "Matches requested production account context.", removedReason: "Billing rows are low-signal for this trace." },
      { id: "raw-events", title: "Raw event stream sample", path: "supabase.portal_events", tokenCount: 760, reason: "Recent events explain usage movement.", removedReason: "Raw event stream is too noisy for agent-ready context." },
      { id: "audit-history", title: "Audit history", path: "supabase.audit_log", tokenCount: 390, reason: "Confirms the request is safe to expose.", removedReason: "Audit rows do not answer the current request." }
    ];
  }
  if (toolName === "hubspot.search_contacts") {
    return [
      { id: "company-profile", title: `${clientName} company profile`, path: "hubspot.companies.violet_labs", tokenCount: 460, reason: "Primary CRM entity for the search request.", removedReason: "Duplicate company fields already selected." },
      { id: "decision-makers", title: "Decision-maker contacts", path: "hubspot.contacts.lifecycle_customer", tokenCount: 520, reason: "Matches contact search intent without exposing unrelated records.", removedReason: "Contacts outside the account were removed." },
      { id: "open-deal", title: "Open renewal deal", path: "hubspot.deals.renewal", tokenCount: 410, reason: "Provides account state for the agent response.", removedReason: "Deal details are not needed for contact search." },
      { id: "last-touch", title: "Last sales touch", path: "hubspot.activities.last_touch", tokenCount: 280, reason: "Recent activity explains why the account was queried.", removedReason: "Activity feed was noisy beyond the latest touch." },
      { id: "marketing-list", title: "Marketing list membership", path: "hubspot.lists.enterprise_accounts", tokenCount: 330, reason: "Helps narrow the CRM record set.", removedReason: "Campaign membership is low-signal for this call." },
      { id: "ticket-noise", title: "Historic support tickets", path: "hubspot.tickets.closed", tokenCount: 620, reason: "Shows past customer friction if needed.", removedReason: "Closed ticket history is not agent-ready for this request." }
    ];
  }
  return [
    { id: "brand-colors", title: `${clientName} approved colours`, path: "brand_assets.kit.colors", tokenCount: 260, reason: "Required for any brand-safe portal output.", removedReason: "Older colour aliases were removed." },
    { id: "logo-set", title: "Logo usage set", path: "brand_assets.logos.primary", tokenCount: 340, reason: "Gives the agent the correct mark and usage rules.", removedReason: "Legacy logo variants are low-signal." },
    { id: "voice-notes", title: "Voice and copy notes", path: "brand_assets.copy.voice", tokenCount: 410, reason: "Keeps generated language aligned to the approved voice.", removedReason: "Long-form copy examples were not needed." },
    { id: "portal-components", title: "Portal component notes", path: "brand_assets.components.portal", tokenCount: 520, reason: "Relevant reusable design context for the requested portal.", removedReason: "Unrelated component inventory was removed." },
    { id: "asset-index", title: "Asset index", path: "brand_assets.index", tokenCount: 310, reason: "Small lookup table for available approved assets.", removedReason: "Asset metadata did not affect the response." },
    { id: "campaign-archive", title: "Campaign archive", path: "brand_assets.archive.campaigns", tokenCount: 700, reason: "Can provide precedent when the request needs examples.", removedReason: "Campaign archive is too broad for agent-ready payload." }
  ];
}

function distributeTokens(candidates: ContextCandidate[], total: number, mode: "selected" | "removed", rand: () => number): ContextTraceItem[] {
  if (!candidates.length) {
    return [];
  }
  const weights = candidates.map((candidate) => candidate.tokenCount * (0.8 + rand() * 0.4));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  let allocated = 0;
  return candidates.map((candidate, index) => {
    const tokenCount = index === candidates.length - 1
      ? Math.max(80, total - allocated)
      : Math.max(80, Math.round((weights[index] / weightTotal) * total));
    allocated += tokenCount;
    return {
      id: `${candidate.id}-${mode}-${index + 1}`,
      title: candidate.title,
      path: candidate.path,
      tokenCount,
      reason: mode === "selected" ? candidate.reason : candidate.removedReason
    };
  });
}

function summariseRequest(toolName: string, args: Record<string, unknown>) {
  if (toolName === "supabase.query") {
    return "Query Supabase customer portal context";
  }
  if (toolName === "hubspot.search_contacts") {
    const query = typeof args.query === "string" ? args.query : "Violet Labs";
    return `Search HubSpot CRM for ${query}`;
  }
  if (toolName === "brand_assets.list_assets") {
    return "List approved brand assets";
  }
  const clientName = typeof args.clientName === "string" ? args.clientName : "Violet Labs";
  return `Get Brand Assets context for ${clientName}`;
}

function demoToolName(toolName: string) {
  if (toolName === "prod_db.query") {
    return "supabase.query";
  }
  return ALLOWED_TRACE_TOOLS.has(toolName) ? toolName : "brand_assets.get_brand_kit";
}

function isDemoTrace(trace: TokenCostOptimisationTrace) {
  return ALLOWED_TRACE_TOOLS.has(trace.toolName)
    && trace.naiveTokens >= 800
    && trace.naiveTokens <= 4800
    && trace.optimisedTokens >= 180
    && trace.optimisedTokens <= 1200
    && trace.tokenReductionPercent >= 45
    && trace.tokenReductionPercent <= 82;
}

function hashSeed(value: string) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number) {
  let state = seed || 1;
  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    return (state >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rand() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
