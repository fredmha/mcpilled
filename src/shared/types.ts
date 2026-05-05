export type ConnectorStatus = "not_connected" | "connected" | "error";
export type AuthType = "token" | "path" | "custom" | "oauth_placeholder";
export type FieldType = "text" | "password" | "textarea";
export type InstallApprovalStatus = "not_started" | "pending" | "active" | "rejected";

export interface RequiredField {
  key: string;
  label: string;
  type: FieldType;
  helpText: string;
}

export interface PermissionAction {
  id: string;
  label: string;
  safeByDefault: boolean;
  toolNames: string[];
}

export interface McpServerDefinition {
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  envMapping?: Record<string, string>;
}

export interface ConnectorDefinition {
  id: string;
  displayName: string;
  description: string;
  longDescription: string;
  authType: AuthType;
  requiredFields: RequiredField[];
  permissionActions: PermissionAction[];
  mcpServer: McpServerDefinition;
  estimatedTools: number;
  available: boolean;
}

export interface StoredConnector {
  id: string;
  enabled: boolean;
  status: ConnectorStatus;
  toolCount: number;
  allowedTools: string[];
  mcpServer?: McpServerDefinition;
  capabilities?: ToolCapability[];
  lastError?: string;
  displayNameOverride?: string;
}

export interface InstallProfile {
  id: string;
  name: string;
  tokenHash: string;
  tokenPreview: string;
  allowedTools: string[];
  createdAt: string;
  lastUsedAt?: string;
  approvalStatus?: InstallApprovalStatus;
  approvalId?: string;
  approvedAt?: string;
  rejectedAt?: string;
}

export interface AdminAgentSettings {
  provider: "openai" | "anthropic";
  model: string;
  modelKeyStored: boolean;
}

export interface ImportedMcpServer {
  id: string;
  name: string;
  sourceClient: "universal" | "claude" | "cursor" | "codex" | "lovable";
  importedAt: string;
  toolPrefix: string;
}

export type ToolClass = "read" | "write";
export type PolicyDecision = "allow" | "deny" | "approval";
export type PolicyScope = "global" | "team" | "user";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type AuditStatus = "success" | "denied" | "pending" | "rejected" | "error";

export interface ToolCapability {
  name: string;
  description: string;
  serverId: string;
  serverName: string;
  classification: ToolClass;
  inputSchema?: Record<string, unknown>;
}

export interface PolicyRule {
  id: string;
  scope: PolicyScope;
  subjectId: string;
  tool?: string;
  classification?: ToolClass;
  decision: PolicyDecision;
  reason: string;
}

export interface ApprovalRequest {
  id: string;
  userId: string;
  teamId: string;
  tool: string;
  input: Record<string, unknown>;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  result?: unknown;
  reason?: string;
  requester?: string;
  requesterName?: string;
  requesterTeam?: string;
  source?: string;
  requestedServers?: string[];
  requestedTools?: ApprovalRequestedTool[];
  summary?: string;
  toolDecisions?: Record<string, "approve" | "deny">;
}

export interface ApprovalRequestedTool {
  server: string;
  tool: string;
  reason: string;
  flagReason: string;
  currentPolicy: "allow" | "deny" | "require_approval" | "inherit";
  input?: Record<string, unknown>;
}

export interface AuditLogEntry {
  id: string;
  user: string;
  team: string;
  tool: string;
  input: Record<string, unknown>;
  status: AuditStatus;
  timestamp: string;
  policyTrace: string[];
  approvalId?: string;
  output?: unknown;
  reason?: string;
}

export interface Space {
  id: string;
  name: string;
  apiKeyHash: string;
  apiKeyPreview: string;
  connectors: StoredConnector[];
  installProfiles: InstallProfile[];
  adminAgent: AdminAgentSettings;
  importedMcpServers: ImportedMcpServer[];
}

export interface GatewayConfig {
  gateway: {
    port: number;
    host: string;
    advancedMode: boolean;
  };
  spaces: Space[];
}

export interface ActivityEntry {
  id: string;
  client: string;
  installProfileId?: string;
  connectorId: string;
  connectorName: string;
  action: string;
  status: "success" | "blocked" | "error";
  durationMs: number;
  createdAt: string;
  detail?: string;
}

export interface AppState {
  gatewayUrl: string;
  advancedMode: boolean;
  status: "Running";
  space: Space;
  connectors: Array<ConnectorDefinition & Partial<StoredConnector>>;
  activity: ActivityEntry[];
  installConfigs: Record<"universal" | "lovable" | "claude" | "cursor" | "codex", string>;
  generatedAdvancedConfig: string;
}

export interface AgentMessage {
  role: "assistant" | "user";
  content: string;
  createdAt: string;
}
