import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { nanoid } from "nanoid";
import type { GatewayConfig, InstallProfile, Space, StoredConnector } from "../shared/types.js";
import { hashApiKey, previewApiKey } from "../spaces/apiKeys.js";
import { deleteState, isDatabaseEnabled, readState, writeState } from "./database.js";

const DATA_DIR = process.env.MCP_GATEWAY_DATA_DIR ?? "data";
export const configPath = join(DATA_DIR, "gateway.json");
export const secretsPath = join(DATA_DIR, "secrets.json");
export const keyPath = join(DATA_DIR, "secrets.key");

export function createApiKey() {
  return `mgw_${nanoid(32)}`;
}

export function createInstallToken() {
  return `mgi_${nanoid(36)}`;
}

const managedConnectors: StoredConnector[] = [
  {
    id: "hubspot",
    enabled: true,
    status: "connected",
    toolCount: 1,
    allowedTools: ["hubspot.search_contacts"],
    displayNameOverride: "HubSpot CRM MCP",
    mcpServer: { transport: "http", url: "https://mcp.hubspot.com/crm" }
  },
  {
    id: "brand_assets",
    enabled: true,
    status: "connected",
    toolCount: 2,
    allowedTools: ["brand_assets.get_brand_kit", "brand_assets.list_assets"],
    displayNameOverride: "Brand Assets MCP",
    mcpServer: { transport: "stdio", command: "node", args: ["dist/demo/brandAssetsMcp.js"] }
  },
  {
    id: "prod_db",
    enabled: true,
    status: "connected",
    toolCount: 1,
    allowedTools: ["prod_db.query"],
    displayNameOverride: "Supabase MCP",
    mcpServer: { transport: "http", url: "https://prod.supabase.internal/mcp" }
  }
];

export async function loadConfig(): Promise<{ config: GatewayConfig; apiKey: string }> {
  if (isDatabaseEnabled()) {
    const existing = await readState<GatewayConfig>("gateway-config");
    if (existing) {
      const config = migrateConfig(existing);
      applyRuntimeGatewayPort(config);
      await saveConfig(config);
      return { config, apiKey: process.env.MCP_GATEWAY_API_KEY ?? "" };
    }
    const created = createDefaultConfig();
    applyRuntimeGatewayPort(created.config);
    await saveConfig(created.config);
    return created;
  }
  await mkdir(dirname(configPath), { recursive: true });
  try {
    const config = migrateConfig(JSON.parse(await readFile(configPath, "utf8")) as GatewayConfig);
    applyRuntimeGatewayPort(config);
    await saveConfig(config);
    const apiKey = process.env.MCP_GATEWAY_API_KEY ?? "";
    return { config, apiKey };
  } catch {
    const { config, apiKey } = createDefaultConfig();
    applyRuntimeGatewayPort(config);
    await saveConfig(config);
    return { config, apiKey };
  }
}

function createDefaultConfig() {
  const apiKey = createApiKey();
  const config: GatewayConfig = {
    gateway: {
      host: process.env.MCP_GATEWAY_HOST ?? "0.0.0.0",
      port: Number(process.env.PORT ?? process.env.MCP_GATEWAY_PORT ?? 3000),
      advancedMode: false
    },
    spaces: [
      {
        id: "default",
        name: "Default Org",
        apiKeyHash: hashApiKey(apiKey),
        apiKeyPreview: previewApiKey(apiKey),
        connectors: managedConnectors,
        installProfiles: [createOwnerInstallProfile(apiKey)],
        adminAgent: {
          provider: "openai",
          model: "gpt-4.1-mini",
          modelKeyStored: false
        },
        importedMcpServers: []
      }
    ]
  };
  return { config, apiKey };
}

function migrateConfig(config: GatewayConfig) {
  for (const space of config.spaces) {
    space.connectors ??= [];
    space.installProfiles ??= [createOwnerInstallProfile()];
    for (const profile of space.installProfiles) {
      profile.approvalStatus ??= "not_started";
    }
    space.adminAgent ??= {
      provider: "openai",
      model: "gpt-4.1-mini",
      modelKeyStored: false
    };
    space.importedMcpServers ??= [];
    const managedById = new Map(managedConnectors.map((connector) => [connector.id, connector]));
    space.connectors = space.connectors.filter((connector) => managedById.has(connector.id));
    for (const connector of managedConnectors) {
      const existing = space.connectors.find((candidate) => candidate.id === connector.id);
      if (existing) {
        Object.assign(existing, connector);
      } else {
        space.connectors.push({ ...connector });
      }
    }
  }
  return config;
}

function applyRuntimeGatewayPort(config: GatewayConfig) {
  const runtimePort = Number(process.env.PORT ?? process.env.MCP_GATEWAY_PORT);
  if (Number.isFinite(runtimePort) && runtimePort > 0) {
    config.gateway.port = runtimePort;
  }
}

export function createOwnerInstallProfile(token = createInstallToken()): InstallProfile {
  return {
    id: "owner",
    name: "Owner install",
    tokenHash: hashApiKey(token),
    tokenPreview: previewApiKey(token),
    allowedTools: ["*"],
    createdAt: new Date().toISOString(),
    approvalStatus: "not_started"
  };
}

export function addInstallProfile(space: Space, name: string, token = createInstallToken()) {
  const profile: InstallProfile = {
    id: nanoid(),
    name,
    tokenHash: hashApiKey(token),
    tokenPreview: previewApiKey(token),
    allowedTools: ["*"],
    createdAt: new Date().toISOString(),
    approvalStatus: "not_started"
  };
  space.installProfiles.push(profile);
  return { profile, token };
}

export async function saveConfig(config: GatewayConfig) {
  if (isDatabaseEnabled()) {
    await writeState("gateway-config", config);
    return;
  }
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

export async function resetConfig() {
  if (isDatabaseEnabled()) {
    await deleteState("gateway-config");
    return loadConfig();
  }
  await rm(configPath, { force: true });
  await rm(secretsPath, { force: true });
  return loadConfig();
}

export function upsertConnector(config: GatewayConfig, spaceId: string, connector: StoredConnector) {
  const space = config.spaces.find((candidate) => candidate.id === spaceId);
  if (!space) {
    throw new Error(`Space not found: ${spaceId}`);
  }
  const index = space.connectors.findIndex((candidate) => candidate.id === connector.id);
  if (index >= 0) {
    space.connectors[index] = connector;
  } else {
    space.connectors.push(connector);
  }
}
