import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { nanoid } from "nanoid";

const DATA_DIR = process.env.MCP_GATEWAY_DATA_DIR ?? "data";
const tracesPath = join(DATA_DIR, "token-cost-optimisations.json");

export interface TokenCostOptimisationTrace {
  id: string;
  createdAt: string;
  appName: string;
  toolName: string;
  requestSummary: string;
  indexedFiles: number;
  selectedFiles: Array<{
    id: string;
    title: string;
    path: string;
    tokenCount: number;
    reason: string;
  }>;
  ignoredFiles: number;
  naiveTokens: number;
  optimisedTokens: number;
  tokenReductionPercent: number;
  estimatedCostBefore: number;
  estimatedCostAfter: number;
  estimatedCostSaved: number;
  status: "optimised";
}

export async function recordTokenCostOptimisation(input: {
  appName: string;
  toolName: string;
  args: Record<string, unknown>;
}): Promise<TokenCostOptimisationTrace> {
  const selectedFiles = [
    {
      id: "customer-interviews-april",
      title: "Customer Interviews — April",
      path: "/personal-files/customer-interviews-april.md",
      tokenCount: 1680,
      reason: "Direct mentions of onboarding confusion and activation blockers."
    },
    {
      id: "onboarding-objections",
      title: "Onboarding Objections",
      path: "/personal-files/onboarding-objections.md",
      tokenCount: 1420,
      reason: "Structured objections from sales and customer calls."
    },
    {
      id: "activation-friction-notes",
      title: "Activation Friction Notes",
      path: "/personal-files/activation-friction-notes.md",
      tokenCount: 1740,
      reason: "Maps drop-off moments to product friction."
    },
    {
      id: "smb-churn-analysis",
      title: "SMB Churn Analysis",
      path: "/personal-files/smb-churn-analysis.md",
      tokenCount: 1470,
      reason: "Shows churn patterns tied to failed onboarding."
    }
  ];

  const naiveTokens = 86200;
  const optimisedTokens = selectedFiles.reduce((sum, file) => sum + file.tokenCount, 0);
  const tokenReductionPercent = Number(((1 - optimisedTokens / naiveTokens) * 100).toFixed(1));
  const costPerMillionTokens = 23.0;
  const estimatedCostBefore = Number(((naiveTokens / 1_000_000) * costPerMillionTokens).toFixed(2));
  const estimatedCostAfter = Number(((optimisedTokens / 1_000_000) * costPerMillionTokens).toFixed(2));
  const estimatedCostSaved = Number((((naiveTokens - optimisedTokens) / 1_000_000) * costPerMillionTokens).toFixed(2));

  const trace: TokenCostOptimisationTrace = {
    id: nanoid(),
    createdAt: new Date().toISOString(),
    appName: input.appName,
    toolName: input.toolName,
    requestSummary: summariseRequest(input.toolName, input.args),
    indexedFiles: 247,
    selectedFiles,
    ignoredFiles: 247 - selectedFiles.length,
    naiveTokens,
    optimisedTokens,
    tokenReductionPercent,
    estimatedCostBefore,
    estimatedCostAfter,
    estimatedCostSaved,
    status: "optimised"
  };

  const traces = await readTokenCostOptimisations(100);
  await writeTraces([trace, ...traces].slice(0, 100));
  return trace;
}

export async function readTokenCostOptimisations(limit = 50): Promise<TokenCostOptimisationTrace[]> {
  try {
    const raw = await readFile(tracesPath, "utf8");
    const traces = JSON.parse(raw) as TokenCostOptimisationTrace[];
    return traces.slice(0, limit);
  } catch {
    return [];
  }
}

export async function resetTokenCostOptimisations() {
  await writeTraces([]);
}

async function writeTraces(traces: TokenCostOptimisationTrace[]) {
  await mkdir(dirname(tracesPath), { recursive: true });
  await writeFile(tracesPath, `${JSON.stringify(traces, null, 2)}\n`);
}

function summariseRequest(toolName: string, args: Record<string, unknown>) {
  if (toolName === "client_portal.create") {
    const clientName = typeof args.clientName === "string" ? args.clientName : "Acme Health";
    return `Create a custom client portal for ${clientName}`;
  }

  if (toolName === "brand_assets.get_brand_kit") {
    const clientName = typeof args.clientName === "string" ? args.clientName : "Acme Health";
    return `Pull approved brand and onboarding context for ${clientName}`;
  }

  if (typeof args.query === "string") {
    return args.query;
  }

  return `Optimise context for ${toolName}`;
}
