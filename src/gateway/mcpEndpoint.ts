import type { Express, Request, Response } from "express";
import type { GatewayConfig, InstallProfile } from "../shared/types.js";
import { forwardToMetaMcp } from "../adapters/metamcpAdapter.js";
import { verifyApiKey } from "../spaces/apiKeys.js";
import { recordTokenCostOptimisation } from "./tokenCostOptimiser.js";
import { handleToolCall, handleToolList } from "./toolRouter.js";

interface InstallGateResult {
  allowed: boolean;
  approvalId?: string;
  message?: string;
}

export function registerMcpEndpoint(app: Express, getConfig: () => GatewayConfig, options?: { legacyToken?: string; onInstallUsed?: (profile: InstallProfile) => Promise<InstallGateResult | void> }) {
  app.options("/mcp", (_req, res) => {
    applyMcpCors(res);
    res.sendStatus(204);
  });

  app.post("/mcp", async (req: Request, res: Response) => {
    applyMcpCors(res);
    const config = getConfig();
    const auth = authToken(req);
    const installProfile = resolveInstallProfile(config, auth, options?.legacyToken);
    if (!installProfile) {
      res.status(401).json({ error: "Invalid install token" });
      return;
    }

    const body = req.body as { id?: string | number; method?: string; params?: Record<string, unknown> };
    const installGate = await options?.onInstallUsed?.(installProfile);
    if (installGate && !installGate.allowed) {
      res.json({
        jsonrpc: "2.0",
        id: body.id,
        error: {
          code: -32001,
          message: installGate.message ?? "MCP install approval is required before this gateway can be used.",
          data: { approvalId: installGate.approvalId, installProfileId: installProfile.id }
        }
      });
      return;
    }

    const forwarded = await forwardToMetaMcp(req);
    if (forwarded) {
      res.status(forwarded.status).type(forwarded.contentType).send(forwarded.body);
      return;
    }

    try {
      if (body.method === "initialize") {
        const requestedProtocolVersion = typeof body.params?.protocolVersion === "string" ? body.params.protocolVersion : "2025-03-26";
        res.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: requestedProtocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "MCP Gateway", version: "0.1.0" }
          }
        });
        return;
      }
      if (body.method === "notifications/initialized") {
        res.status(202).end();
        return;
      }
      if (body.method === "tools/list") {
        res.json({ jsonrpc: "2.0", id: body.id, result: await handleToolList(config) });
        return;
      }
      if (body.method === "tools/call") {
        const params = body.params as { name?: string; arguments?: Record<string, unknown> };
        let optimisation;
        try {
          optimisation = await recordTokenCostOptimisation({
            appName: req.header("x-client-name") ?? installProfile.name ?? "External MCP App",
            toolName: params.name ?? "",
            args: params.arguments ?? {}
          });
        } catch (error) {
          console.warn("Token cost optimiser failed", error);
        }
        const result = await handleToolCall(config, params.name ?? "", params.arguments ?? {}, req.header("x-client-name") ?? installProfile.name, installProfile, {
          userId: req.header("x-user-id") ?? "fred.haris",
          teamId: req.header("x-team-id") ?? "users"
        });
        const responseResult = optimisation && result && typeof result === "object" && !Array.isArray(result)
          ? { ...result, optimisation }
          : result;
        res.json({ jsonrpc: "2.0", id: body.id, result: responseResult });
        return;
      }
      res.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "MCP Gateway", version: "0.1.0" }
        }
      });
    } catch (error) {
      res.status(403).json({
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32000, message: error instanceof Error ? error.message : "Tool call failed" }
      });
    }
  });

  app.get("/mcp", (_req, res) => {
    applyMcpCors(res);
    res.json({ name: "MCP Gateway", endpoint: "/mcp", transport: "http" });
  });
}

function applyMcpCors(res: Response) {
  res.header("access-control-allow-origin", "*");
  res.header("access-control-allow-methods", "GET,POST,OPTIONS");
  res.header("access-control-allow-headers", "authorization,content-type,accept,x-api-key,x-mcp-api-key,x-client-name,x-user-id,x-team-id,ngrok-skip-browser-warning");
  res.header("access-control-max-age", "86400");
}

function authToken(req: Request) {
  const header = normalizeAuthToken(req.header("authorization"));
  if (header) {
    return header;
  }
  const apiKey = req.header("x-api-key") ?? req.header("x-mcp-api-key");
  if (apiKey) {
    return normalizeAuthToken(apiKey);
  }
  const queryToken = req.query.token ?? req.query.api_key ?? req.query.apiKey ?? req.query.key;
  return typeof queryToken === "string" ? normalizeAuthToken(queryToken) : undefined;
}

function normalizeAuthToken(value?: string) {
  let token = value?.trim();
  if (!token) {
    return undefined;
  }
  token = token.replace(/^["']|["']$/g, "").trim();
  while (/^Bearer\s+/i.test(token)) {
    token = token.replace(/^Bearer\s+/i, "").trim();
  }
  token = token.replace(/^["']|["']$/g, "").trim();
  return token || undefined;
}

function resolveInstallProfile(config: GatewayConfig, auth?: string, legacyToken?: string) {
  if (!auth) {
    return null;
  }
  const space = config.spaces[0];
  const profile = space.installProfiles.find((candidate) => verifyApiKey(auth, candidate.tokenHash));
  if (profile) {
    return profile;
  }
  if (legacyToken && auth === legacyToken) {
    return space.installProfiles[0] ?? null;
  }
  return null;
}
