import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Database,
  FileText,
  KeyRound,
  ListChecks,
  Plug,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  Shield,
  ShieldCheck,
  Terminal,
  XCircle
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { ApprovalRequest } from "../../../shared/types";
import "./styles.css";

type Page = "servers" | "approvals" | "install" | "optimiser";
type UiDecision = "allow" | "deny" | "require_approval" | "inherit";
type ToolDecision = "approve" | "deny";

interface User {
  id: string;
  name: string;
  email: string;
  color: string;
}

interface ControlServer {
  id: string;
  name: string;
  status: string;
  enabled: boolean;
  endpoint: string;
  transport: "http" | "stdio";
  toolCount: number;
  tools: string[];
  global: UiDecision;
  teams: Record<string, UiDecision>;
  users: Record<string, UiDecision>;
  lastError?: string;
}

interface ControlApproval extends ApprovalRequest {
  requester?: string;
  requesterName?: string;
  requesterTeam?: string;
  source?: string;
  timestamp?: string;
  requestedServers?: string[];
  requestedTools?: Array<{
    server: string;
    tool: string;
    reason: string;
    flagReason: string;
    currentPolicy: UiDecision;
  }>;
  summary?: string;
}

interface InstallProfileSummary {
  id: string;
  name: string;
  tokenPreview: string;
  allowedTools: string[];
  createdAt: string;
  lastUsedAt?: string;
  approvalStatus: "not_started" | "pending" | "active" | "rejected";
  approvalId?: string;
  approvedAt?: string;
  rejectedAt?: string;
}

interface ControlRoomPayload {
  gatewayUrl: string;
  stats: {
    servers: number;
    tools: number;
    pendingApprovals: number;
    totalCalls: number;
  };
  users: Record<string, User>;
  mcpServers: ControlServer[];
  pendingApprovals: ControlApproval[];
  installConfigs: Record<string, string>;
  installProfiles: InstallProfileSummary[];
}

interface TokenCostOptimisationTrace {
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
  removedFiles?: Array<{
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
  status: "optimised";
}

const navItems: Array<{ page: Page; label: string; icon: React.ReactNode }> = [
  { page: "servers", label: "MCP Servers", icon: <Plug size={18} /> },
  { page: "approvals", label: "Approvals", icon: <ListChecks size={18} /> },
  { page: "install", label: "Install", icon: <KeyRound size={18} /> },
  { page: "optimiser", label: "Token Optimiser", icon: <BarChart3 size={18} /> }
];

function App() {
  const [data, setData] = useState<ControlRoomPayload | null>(null);
  const [page, setPage] = useState<Page>("servers");
  const [notice, setNotice] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);

  async function refresh() {
    const response = await fetch("/api/control-room");
    setData(await response.json());
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(timer);
  }, []);

  async function submitToolDecisions(id: string, decisions: Record<string, ToolDecision>) {
    await fetch(`/api/approvals/${id}/tool-decisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ admin: "admin", decisions })
    });
    setNotice("Approval decisions submitted");
    window.setTimeout(() => setNotice(""), 2200);
    await refresh();
  }

  async function reject(id: string) {
    await fetch(`/api/approvals/${id}/reject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ admin: "admin", reason: "Rejected from control room." })
    });
    await refresh();
  }

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setNotice(`${label} copied`);
    window.setTimeout(() => setNotice(""), 1800);
  }

  if (!data) {
    return <div className="loading">Loading MCP Gateway...</div>;
  }

  return (
    <div className="appShell">
      <main className="workspace">
        <TopBar data={data} notice={notice} refresh={refresh} copy={copy} page={page} setPage={setPage} />
        {page === "servers" && <ServersView data={data} refresh={refresh} openRegister={() => setRegisterOpen(true)} />}
        {page === "approvals" && <ApprovalsView approvals={data.pendingApprovals} reject={reject} submitToolDecisions={submitToolDecisions} />}
        {page === "install" && <InstallView data={data} copy={copy} refresh={refresh} />}
        {page === "optimiser" && <TokenCostOptimiserPage />}
      </main>
      {registerOpen && <RegisterServerDrawer close={() => setRegisterOpen(false)} refresh={refresh} />}
    </div>
  );
}

function Sidebar({ page, setPage, pendingCount }: { page: Page; setPage: (page: Page) => void; pendingCount: number }) {
  return (
    <div className="sidebar">
      <div className="brand">
        <div className="brandIcon"><Shield size={22} /></div>
        <div>
          <strong>MCP Gateway</strong>
          <span>Control Room</span>
        </div>
      </div>
      <nav className="navList">
        {navItems.map((item) => (
          <button className={page === item.page ? "navItem active" : "navItem"} key={item.page} onClick={() => setPage(item.page)}>
            {item.icon}
            <span>{item.label}</span>
            {item.page === "approvals" && pendingCount > 0 && <em>{pendingCount}</em>}
          </button>
        ))}
      </nav>
    </div>
  );
}

function TopBar({
  data,
  notice,
  refresh,
  copy,
  page,
  setPage
}: {
  data: ControlRoomPayload;
  notice: string;
  refresh: () => Promise<void>;
  copy: (value: string, label: string) => Promise<void>;
  page: Page;
  setPage: (page: Page) => void;
}) {
  return (
    <header className="topBar">
      <Sidebar page={page} setPage={setPage} pendingCount={data.stats.pendingApprovals} />
      <div className="topActions">
        {notice && <div className="notice">{notice}</div>}
        <button onClick={() => copy(data.gatewayUrl, "Gateway URL")}><Clipboard size={16} />Copy</button>
        <button onClick={refresh}><RefreshCw size={16} />Refresh</button>
      </div>
    </header>
  );
}

function ServersView({ data, refresh, openRegister }: { data: ControlRoomPayload; refresh: () => Promise<void>; openRegister: () => void }) {
  const [expandedServer, setExpandedServer] = useState<string | null>(data.mcpServers[0]?.id ?? null);
  const gatewayIsLocal = data.gatewayUrl.includes("localhost") || data.gatewayUrl.includes("127.0.0.1");

  async function updateAccess(server: ControlServer, patch: Partial<Pick<ControlServer, "global" | "teams" | "users">>) {
    const body = {
      global: patch.global ?? server.global,
      teams: patch.teams ?? server.teams,
      users: patch.users ?? server.users
    };
    await fetch(`/api/control-room/servers/${server.id}/access`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    await refresh();
  }

  async function toggleEnabled(server: ControlServer) {
    await fetch(`/api/servers/${server.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !server.enabled })
    });
    await refresh();
  }

  async function indexServer(server: ControlServer) {
    await fetch(`/api/servers/${server.id}/index`, { method: "POST" });
    await refresh();
  }

  return (
    <section className="pageStack">
      <div className="dashboardHeader">
        <div className="dashboardTitle">
          <span className="sectionLabel">Control room</span>
          <h1>Servers</h1>
          <p>Downstream MCP inventory, access policy, and install endpoint status.</p>
        </div>
        <div className="dashboardActions">
          <button className="primary" onClick={openRegister}><Plus size={16} />Register server</button>
          <button onClick={refresh}><RefreshCw size={16} />Refresh</button>
        </div>
      </div>
      <div className="opsOverview">
        <div className="endpointPanel">
          <div>
            <span className="sectionLabel">Unified gateway endpoint</span>
            {gatewayIsLocal && <em>Local fallback</em>}
          </div>
          <strong className="mono">{data.gatewayUrl}</strong>
          <button onClick={() => navigator.clipboard.writeText(data.gatewayUrl)}><Clipboard size={16} />Copy endpoint</button>
        </div>
        <div className="statRail">
          <StatCard label="Servers" value={data.stats.servers} tone="purple" />
          <StatCard label="Tools" value={data.stats.tools} tone="blue" />
          <StatCard label="Pending approvals" value={data.stats.pendingApprovals} tone="orange" />
          <StatCard label="Total calls" value={data.stats.totalCalls} tone="teal" />
        </div>
      </div>
      {data.mcpServers.map((server) => (
        <ServerCard
          isExpanded={expandedServer === server.id}
          key={server.id}
          onIndex={() => indexServer(server)}
          onSelect={() => setExpandedServer(expandedServer === server.id ? null : server.id)}
          onToggle={() => toggleEnabled(server)}
          onUpdate={(patch) => updateAccess(server, patch)}
          server={server}
          users={data.users}
        />
      ))}
    </section>
  );
}

function ServerCard({
  server,
  onSelect,
  isExpanded,
  onUpdate,
  onToggle,
  onIndex,
  users
}: {
  server: ControlServer;
  onSelect: () => void;
  isExpanded: boolean;
  onUpdate: (patch: Partial<Pick<ControlServer, "global" | "teams" | "users">>) => void;
  onToggle: () => void;
  onIndex: () => void;
  users: Record<string, User>;
}) {
  return (
    <article className="serverCard">
      <button className="serverSummary" onClick={onSelect}>
        <div className="serverIdentity">
          <div className="serverIcon" style={{ borderColor: policyColor(server.global), color: policyColor(server.global) }}><Server size={23} /></div>
          <div>
            <div className="titleRow">
              <h2>{server.name}</h2>
              <StatusBadge status={server.status} />
            </div>
            <span className="mono">{server.endpoint}</span>
          </div>
        </div>
        <div className="serverMeta">
          <MetricNumber label="tools" value={server.toolCount} />
          <PolicyPill value={server.global} prefix="Global" />
          {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
        </div>
      </button>

      {isExpanded && (
        <div className="serverDetails">
          <div className="serverActions">
            <button onClick={onToggle}>{server.enabled ? "Disable" : "Enable"}</button>
            <button onClick={onIndex}>Index tools</button>
            <span>{server.transport.toUpperCase()}</span>
          </div>

          <section className="accessBlock">
            <div>
              <h3>Global Policy</h3>
              <p>Applies to every user unless overridden below.</p>
            </div>
            <PolicySelect value={server.global} onChange={(global) => onUpdate({ global })} />
          </section>

          <section className="accessBlock vertical">
            <div>
              <h3>User Overrides</h3>
              <p>User policies override the global policy for this MCP.</p>
            </div>
            <div className="userPolicyList">
              {Object.values(users).map((user) => (
                <div className="userPolicy" key={user.id}>
                  <div className="userIdentity">
                    <div className="avatar small" style={{ borderColor: user.color, color: user.color }}>{initials(user.name)}</div>
                    <div>
                      <strong>{user.name}</strong>
                      <span className="mono">{user.email}</span>
                    </div>
                  </div>
                  <PolicySelect value={server.users[user.id] ?? "inherit"} onChange={(value) => onUpdate({ users: { ...server.users, [user.id]: value } })} />
                </div>
              ))}
            </div>
          </section>

          <section className="toolBlock">
            <h3>Available Tools</h3>
            <div className="toolChips">
              {server.tools.map((tool) => <span className="toolChip" key={tool}>{tool}</span>)}
            </div>
          </section>
        </div>
      )}
    </article>
  );
}

function ApprovalsView({ approvals, submitToolDecisions, reject }: { approvals: ControlApproval[]; submitToolDecisions: (id: string, decisions: Record<string, ToolDecision>) => Promise<void>; reject: (id: string) => Promise<void> }) {
  const [activeApprovalId, setActiveApprovalId] = useState<string | null>(approvals[0]?.id ?? null);
  useEffect(() => {
    if (!approvals.length) {
      setActiveApprovalId(null);
      return;
    }
    if (!activeApprovalId || !approvals.some((approval) => approval.id === activeApprovalId)) {
      setActiveApprovalId(approvals[0].id);
    }
  }, [activeApprovalId, approvals]);
  const activeApproval = approvals.find((approval) => approval.id === activeApprovalId) ?? approvals[0];

  return (
    <section className="pageStack">
      <div className="pageHeader">
        <div>
          <h1>Approvals</h1>
          <p>Review blocked tool requests one workflow at a time.</p>
        </div>
      </div>
      {approvals.length === 0 && <EmptyState title="No pending approvals" text="Requests that require admin review will appear here." />}
      {approvals.length > 0 && (
        <div className="approvalWorkspace">
          <div className="approvalTabs" role="tablist" aria-label="Pending approval requests">
            {approvals.map((approval, index) => (
              <button
                aria-selected={approval.id === activeApproval?.id}
                className={approval.id === activeApproval?.id ? "approvalTab active" : "approvalTab"}
                key={approval.id}
                onClick={() => setActiveApprovalId(approval.id)}
                role="tab"
              >
                <span>Request {index + 1}</span>
                <strong>{approval.requesterName ?? approval.userId}</strong>
                <small>{approval.requestedTools?.length ?? 1} tools</small>
              </button>
            ))}
          </div>
          {activeApproval && <ApprovalCard approval={activeApproval} key={activeApproval.id} reject={reject} submitToolDecisions={submitToolDecisions} />}
        </div>
      )}
    </section>
  );
}

function ApprovalCard({ approval, submitToolDecisions, reject }: { approval: ControlApproval; submitToolDecisions: (id: string, decisions: Record<string, ToolDecision>) => Promise<void>; reject: (id: string) => Promise<void> }) {
  const [toolDecisions, setToolDecisions] = useState<Record<string, ToolDecision>>({});
  const requestedTools = approval.requestedTools?.length ? approval.requestedTools : [{
    server: approval.tool.split(".")[0] ?? "mcp",
    tool: approval.tool,
    reason: approval.reason ?? "Policy requires approval.",
    flagReason: approval.reason ?? "Policy requires approval.",
    currentPolicy: "require_approval" as UiDecision
  }];
  const approvedCount = Object.values(toolDecisions).filter((decision) => decision === "approve").length;
  const deniedCount = Object.values(toolDecisions).filter((decision) => decision === "deny").length;
  const allReviewed = requestedTools.every((tool) => toolDecisions[tool.tool]);

  function toggleTool(toolName: string, decision: ToolDecision) {
    setToolDecisions((current) => {
      const next = { ...current };
      if (next[toolName] === decision) {
        delete next[toolName];
      } else {
        next[toolName] = decision;
      }
      return next;
    });
  }

  return (
    <article className="approvalRequestCard">
      <div className="approvalHeader">
        <div>
          <h2>{approval.requesterName ?? approval.userId}</h2>
          <p className="mono">{approval.requester ?? approval.userId}</p>
        </div>
        <span className="minutesBadge">{timeAgo(approval.timestamp ?? approval.createdAt)}</span>
      </div>
      <div className="approvalContext">
        <span>User based policy</span>
        <span>Source: {approval.source ?? "MCP Gateway"}</span>
      </div>
      <p className="summary">{approval.summary ?? `${approval.userId} requested ${approval.tool}.`}</p>
      <div className="requestedTitle">Requested Tools</div>
      <div className="requestedTools">
        {requestedTools.map((item) => (
          <div className={`requestedTool ${toolDecisions[item.tool] ?? ""}`} key={`${approval.id}-${item.tool}`}>
            <strong className="mono">{item.tool}</strong>
            <span>{item.reason}</span>
            <small>{item.flagReason}</small>
            <div className="toolDecisionButtons">
              <button className={toolDecisions[item.tool] === "approve" ? "approved" : ""} onClick={() => toggleTool(item.tool, "approve")}>
                {toolDecisions[item.tool] === "approve" ? "Approved" : "Approve"}
              </button>
              <button className={toolDecisions[item.tool] === "deny" ? "denied" : ""} onClick={() => toggleTool(item.tool, "deny")}>
                {toolDecisions[item.tool] === "deny" ? "Denied" : "Deny"}
              </button>
            </div>
          </div>
        ))}
      </div>
      {approval.status === "pending" && (
        <div className="approvalSubmit">
          <button
            className="primary"
            disabled={!allReviewed}
            onClick={() => submitToolDecisions(approval.id, toolDecisions)}
          >
            {allReviewed ? `Submit (${approvedCount} approved, ${deniedCount} denied)` : `Review all ${requestedTools.length} tools to continue`}
          </button>
          <button onClick={() => reject(approval.id)}><XCircle size={16} />Reject all</button>
        </div>
      )}
    </article>
  );
}

function TeamsView({ data }: { data: ControlRoomPayload }) {
  const [selectedTeam, setSelectedTeam] = useState<string | null>(Object.keys(data.teams)[0] ?? null);
  return (
    <section className="pageStack">
      <div className="pageHeader">
        <div>
          <h1>Teams</h1>
          <p>Team membership is inferred from active policies, approvals, and audit records.</p>
        </div>
      </div>
      {Object.values(data.teams).map((team) => (
        <article className="teamCard" key={team.id}>
          <button className="teamHeader" onClick={() => setSelectedTeam(selectedTeam === team.id ? null : team.id)}>
            <div className="avatar" style={{ color: team.color, borderColor: team.color }}>{team.name.charAt(0).toUpperCase()}</div>
            <div>
              <h2>{team.name}</h2>
              <span>{team.members.length} members</span>
            </div>
            {selectedTeam === team.id ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
          </button>
          {selectedTeam === team.id && (
            <div className="memberList">
              {team.members.map((member) => (
                <div className="memberRow" key={member}>
                  <div className="avatar small" style={{ color: team.color, borderColor: team.color }}>{member.charAt(0).toUpperCase()}</div>
                  <div>
                    <strong>{member}</strong>
                    <span className="mono">{member.includes("@") ? member : `${member}@company.io`}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      ))}
    </section>
  );
}

function ActivityView({ data, busyScenario, runScenario }: { data: ControlRoomPayload; busyScenario: Scenario | null; runScenario: (scenario: Scenario) => Promise<void> }) {
  return (
    <section className="activityGrid">
      <div className="pageHeader activityHeader">
        <div>
          <h1>Activity</h1>
          <p>Monitor live MCP calls and policy evaluation traces.</p>
        </div>
      </div>
      <section className="panel">
        <h2>Demo request flow</h2>
        <div className="scenarioGrid">
          {scenarios.map((scenario) => (
            <button className="scenario" disabled={busyScenario !== null} key={scenario.id} onClick={() => runScenario(scenario.id)}>
              <Play size={16} />
              <strong>{scenario.title}</strong>
              <span>{scenario.actor}</span>
              <small>{scenario.detail}</small>
            </button>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>Live Requests</h2>
        {data.liveRequests.length === 0 && <EmptyState title="No recent requests" text="Run a scenario or call the gateway to populate the live feed." />}
        <div className="requestFeed">
          {data.liveRequests.map((request) => <RequestCard key={request.id} request={request} />)}
        </div>
      </section>
      <section className="panel auditPanel">
        <h2>Audit Timeline</h2>
        <AuditTable rows={data.auditLogs} />
      </section>
    </section>
  );
}

function RequestCard({ request }: { request: LiveRequest }) {
  return (
    <article className="requestCard">
      <div className="requestTop">
        <StatusBadge status={request.status} />
        <span>{timeAgo(request.timestamp)}</span>
      </div>
      <strong className="mono">{request.tool}</strong>
      <p>{request.user} / {request.team}</p>
      <div className="policyFlow">
        <PolicyPill value={request.globalPolicy} prefix="Global" />
        <PolicyPill value={request.teamPolicy} prefix="Team" />
        <PolicyPill value={request.userPolicy} prefix="User" />
      </div>
    </article>
  );
}

function PoliciesView({ data, refresh }: { data: ControlRoomPayload; refresh: () => Promise<void> }) {
  const [draft, setDraft] = useState(data.mcpServers);
  useEffect(() => setDraft(data.mcpServers), [data.mcpServers]);

  async function save() {
    await Promise.all(draft.map((server) => fetch(`/api/control-room/servers/${server.id}/access`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ global: server.global, teams: server.teams, users: server.users })
    })));
    await refresh();
  }

  function updateServer(id: string, patch: Partial<Pick<ControlServer, "global" | "teams" | "users">>) {
    setDraft((servers) => servers.map((server) => server.id === id ? { ...server, ...patch } : server));
  }

  return (
    <section className="pageStack">
      <div className="pageHeader">
        <div>
          <h1>Policy Matrix</h1>
          <p>Configure global, team, and user policy layers with stackable precedence.</p>
        </div>
        <button className="primary" onClick={save}><Save size={16} />Save policies</button>
      </div>
      <div className="policyMatrix">
        <div className="policyHead">Server</div>
        <div className="policyHead">Global</div>
        <div className="policyHead">User overrides</div>
        <div className="policyHead">User overrides</div>
        {draft.map((server) => (
          <React.Fragment key={server.id}>
            <div className="policyCell serverName">
              <strong>{server.name}</strong>
              <span>{server.toolCount} tools</span>
            </div>
            <div className="policyCell"><PolicySelect value={server.global} onChange={(global) => updateServer(server.id, { global })} /></div>
            <div className="policyCell stackCell">
              {Object.entries(server.teams).map(([teamId, decision]) => (
                <label className="inlinePolicy" key={teamId}>
                  <span>{teamId}</span>
                  <PolicySelect value={decision} onChange={(value) => updateServer(server.id, { teams: { ...server.teams, [teamId]: value } })} />
                </label>
              ))}
            </div>
            <div className="policyCell stackCell">
              {Object.entries(server.users).filter(([, decision]) => decision !== "inherit").slice(0, 8).map(([userId, decision]) => (
                <label className="inlinePolicy" key={userId}>
                  <span className="mono">{userId}</span>
                  <PolicySelect value={decision} onChange={(value) => updateServer(server.id, { users: { ...server.users, [userId]: value } })} />
                </label>
              ))}
              {Object.values(server.users).every((decision) => decision === "inherit") && <span className="muted">All inherit</span>}
            </div>
          </React.Fragment>
        ))}
      </div>
    </section>
  );
}

function TokenCostOptimiserPage() {
  const [traces, setTraces] = useState<TokenCostOptimisationTrace[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const visibleTraces = traces.length ? traces : demoContextTraces();
  const selectedTrace = visibleTraces.find((trace) => trace.id === selectedId) ?? visibleTraces[0];
  const totals = useMemo(() => {
    const removedTokens = visibleTraces.reduce((sum, trace) => sum + tokensSaved(trace), 0);
    const averageReduction = visibleTraces.length
      ? visibleTraces.reduce((sum, trace) => sum + trace.tokenReductionPercent, 0) / visibleTraces.length
      : 0;
    return {
      removedTokens,
      averageReduction,
      requestCount: visibleTraces.length
    };
  }, [visibleTraces]);
  const chartData = useMemo(() => {
    const source = visibleTraces.slice(0, 8).reverse();
    return source.map((trace, index) => ({
      name: source.length <= 1 ? "Latest" : `Req ${index + 1}`,
      indexed: trace.naiveTokens,
      selected: trace.optimisedTokens,
      removed: tokensSaved(trace)
    }));
  }, [visibleTraces]);
  const removedFiles = traceRemovedFiles(selectedTrace);

  async function refreshOptimisations() {
    const response = await fetch("/api/token-cost-optimisations");
    const payload = await response.json() as { optimisations: TokenCostOptimisationTrace[] };
    setTraces(payload.optimisations);
    setSelectedId((current) => current && payload.optimisations.some((trace) => trace.id === current) ? current : payload.optimisations[0]?.id ?? null);
  }

  useEffect(() => {
    void refreshOptimisations();
    const timer = window.setInterval(() => void refreshOptimisations(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="tokenPage">
      <div className="dashboardHeader">
        <div className="dashboardTitle">
          <h1>Token Optimiser</h1>
          <p>Context traces for MCP calls: indexed context, selected payload, and removed low-signal context.</p>
        </div>
      </div>

      <section className="tokenPanel chartPanel">
        <div className="panelTitleRow">
          <div>
            <span className="sectionLabel">Context trace volume</span>
            <h2>Indexed vs selected payload</h2>
          </div>
          <span className="projectionPill">{formatCompactTokens(totals.removedTokens)} removed</span>
        </div>
        <div className="chartSurface">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#777169" }} />
              <YAxis tick={{ fontSize: 12, fill: "#777169" }} tickFormatter={(value) => formatCompactTokens(Number(value))} />
              <Tooltip formatter={(value: number) => `${formatNumber(Number(value))} tokens`} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="indexed" name="Indexed" fill="#b1b0b0" radius={[4, 4, 0, 0]} />
              <Bar dataKey="selected" name="Selected" fill="#0447ff" radius={[4, 4, 0, 0]} />
              <Bar dataKey="removed" name="Removed" fill="#000000" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="tokenPanel logPanel">
        <div className="panelTitleRow">
          <div>
            <span className="sectionLabel">Recent calls</span>
            <h2>Context traces</h2>
          </div>
          <span className="projectionPill">{formatNumber(totals.requestCount)} requests</span>
        </div>
        <div className="tokenTableWrap">
          <table className="tokenTable">
            <thead>
              <tr>
                <th>Time</th>
                <th>MCP</th>
                <th>Tool</th>
                <th className="right">Indexed</th>
                <th className="right">Selected</th>
                <th className="right">Removed</th>
                <th className="right">Reduction</th>
              </tr>
            </thead>
            <tbody>
              {visibleTraces.map((trace) => (
                <tr className={trace.id === selectedTrace.id ? "active" : ""} key={trace.id} onClick={() => setSelectedId(trace.id)}>
                  <td>{new Date(trace.createdAt).toLocaleTimeString()}</td>
                  <td>{mcpName(trace.toolName)}</td>
                  <td className="mono">{trace.toolName}</td>
                  <td className="right">{formatNumber(trace.naiveTokens)}</td>
                  <td className="right">{formatNumber(trace.optimisedTokens)}</td>
                  <td className="right">{formatNumber(tokensSaved(trace))}</td>
                  <td className="right">{trace.tokenReductionPercent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="tokenPanel detailPanel">
        <div className="panelTitleRow">
          <div>
            <span className="sectionLabel">Context trace</span>
            <h2>{selectedTrace.requestSummary}</h2>
          </div>
          <span className="projectionPill">{mcpName(selectedTrace.toolName)}</span>
        </div>
        <div className="latestRequestGrid">
          <LatestItem label="Indexed" value={`${formatNumber(selectedTrace.naiveTokens)} tokens`} />
          <LatestItem label="Selected" value={`${formatNumber(selectedTrace.optimisedTokens)} tokens`} />
          <LatestItem label="Removed" value={`${formatNumber(tokensSaved(selectedTrace))} tokens`} />
          <LatestItem label="Reduction" value={`${selectedTrace.tokenReductionPercent}%`} />
        </div>
        <div className="tokenFlow">
          <FlowStep label="Candidate context" value={`${formatNumber(selectedTrace.indexedFiles)} items`} />
          <FlowStep label="Agent-ready payload" value={`${selectedTrace.selectedFiles.length} items`} />
          <FlowStep label="Removed context" value={`${formatNumber(selectedTrace.ignoredFiles)} items`} />
        </div>
        <div className="contextTraceGrid">
          <div className="contextTraceColumn">
            <div className="selectedHeader">
              <span className="sectionLabel">Agent-ready payload</span>
              <span className="ignoredBadge">{formatNumber(selectedTrace.optimisedTokens)} tokens</span>
            </div>
            <div className="selectedFiles">
              {selectedTrace.selectedFiles.map((file) => (
                <article className="selectedFile" key={file.id}>
                  <FileText size={18} />
                  <div>
                    <h3>{file.title}</h3>
                    <span className="mono">{file.path}</span>
                    <p>{file.reason}</p>
                  </div>
                  <strong>{formatNumber(file.tokenCount)}</strong>
                </article>
              ))}
            </div>
          </div>
          <div className="contextTraceColumn">
            <div className="selectedHeader">
              <span className="sectionLabel">Removed context</span>
              <span className="ignoredBadge">{formatNumber(tokensSaved(selectedTrace))} tokens</span>
            </div>
            <div className="selectedFiles">
              {removedFiles.map((file) => (
                <article className="selectedFile removed" key={file.id}>
                  <FileText size={18} />
                  <div>
                    <h3>{file.title}</h3>
                    <span className="mono">{file.path}</span>
                    <p>{file.reason}</p>
                  </div>
                  <strong>{formatNumber(file.tokenCount)}</strong>
                </article>
              ))}
              <div className="tokenSentence">
                Candidate context started at {formatCompactTokens(selectedTrace.naiveTokens)} tokens. The gateway prepared {formatCompactTokens(selectedTrace.optimisedTokens)} tokens for the agent.
              </div>
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}

function demoContextTraces(): TokenCostOptimisationTrace[] {
  const base = Date.now();
  return [
    {
      id: "demo-brand-assets",
      createdAt: new Date(base - 38_000).toISOString(),
      appName: "demo-runner",
      toolName: "brand_assets.get_brand_kit",
      requestSummary: "Get Brand Assets context for Violet Labs",
      indexedFiles: 9,
      selectedFiles: [
        { id: "demo-brand-colors", title: "Violet Labs approved colours", path: "brand_assets.kit.colors", tokenCount: 220, reason: "Required for brand-safe portal output." },
        { id: "demo-brand-components", title: "Portal component notes", path: "brand_assets.components.portal", tokenCount: 310, reason: "Relevant reusable design context for the requested portal." }
      ],
      removedFiles: [
        { id: "demo-brand-archive", title: "Campaign archive", path: "brand_assets.archive.campaigns", tokenCount: 720, reason: "Campaign archive is too broad for this MCP call." },
        { id: "demo-brand-legacy", title: "Legacy logo variants", path: "brand_assets.logos.legacy", tokenCount: 460, reason: "Legacy assets are low-signal for agent-ready payload." }
      ],
      ignoredFiles: 7,
      naiveTokens: 1980,
      optimisedTokens: 530,
      tokenReductionPercent: 73.2,
      status: "optimised"
    },
    {
      id: "demo-hubspot",
      createdAt: new Date(base - 78_000).toISOString(),
      appName: "demo-runner",
      toolName: "hubspot.search_contacts",
      requestSummary: "Search HubSpot CRM for Violet Labs",
      indexedFiles: 14,
      selectedFiles: [
        { id: "demo-hubspot-company", title: "Violet Labs company profile", path: "hubspot.companies.violet_labs", tokenCount: 360, reason: "Primary CRM entity for the search request." },
        { id: "demo-hubspot-contacts", title: "Decision-maker contacts", path: "hubspot.contacts.lifecycle_customer", tokenCount: 410, reason: "Matches contact search intent without unrelated records." }
      ],
      removedFiles: [
        { id: "demo-hubspot-tickets", title: "Historic support tickets", path: "hubspot.tickets.closed", tokenCount: 820, reason: "Closed ticket history is not needed for contact search." },
        { id: "demo-hubspot-campaigns", title: "Marketing list membership", path: "hubspot.lists.enterprise_accounts", tokenCount: 520, reason: "Campaign membership is low-signal for this call." }
      ],
      ignoredFiles: 12,
      naiveTokens: 3140,
      optimisedTokens: 770,
      tokenReductionPercent: 75.5,
      status: "optimised"
    },
    {
      id: "demo-supabase",
      createdAt: new Date(base - 128_000).toISOString(),
      appName: "demo-runner",
      toolName: "supabase.query",
      requestSummary: "Query Supabase customer portal context",
      indexedFiles: 11,
      selectedFiles: [
        { id: "demo-supabase-usage", title: "Portal usage summary", path: "supabase.customer_portal_usage", tokenCount: 380, reason: "Directly supports account usage context for the MCP request." },
        { id: "demo-supabase-schema", title: "Query schema note", path: "supabase.schema.customer_portal_context", tokenCount: 210, reason: "Keeps the agent aligned to the allowed query shape." }
      ],
      removedFiles: [
        { id: "demo-supabase-events", title: "Raw event stream sample", path: "supabase.portal_events", tokenCount: 690, reason: "Raw event stream is too noisy for agent-ready context." },
        { id: "demo-supabase-audit", title: "Audit history", path: "supabase.audit_log", tokenCount: 410, reason: "Audit rows do not answer the current request." }
      ],
      ignoredFiles: 9,
      naiveTokens: 2460,
      optimisedTokens: 590,
      tokenReductionPercent: 76,
      status: "optimised"
    }
  ];
}

function traceRemovedFiles(trace: TokenCostOptimisationTrace) {
  if (trace.removedFiles?.length) {
    return trace.removedFiles;
  }
  return [{
    id: `${trace.id}-removed-summary`,
    title: "Low-signal candidate context",
    path: `${mcpName(trace.toolName).toLowerCase().replace(/\s+/g, "_")}.candidate_context`,
    tokenCount: tokensSaved(trace),
    reason: "Broad context was removed before creating the agent-ready payload."
  }];
}

function mcpName(toolName: string) {
  if (toolName === "supabase.query" || toolName === "prod_db.query") return "Supabase";
  if (toolName.startsWith("hubspot.")) return "HubSpot";
  if (toolName.startsWith("brand_assets.")) return "Brand Assets";
  return "MCP";
}

function LatestItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div className="latestItem"><span>{label}</span><strong className={mono ? "mono" : ""}>{value}</strong></div>;
}

function FlowStep({ label, value }: { label: string; value: string }) {
  return <div className="flowStep"><CheckCircle2 size={16} /><span>{label}</span><strong>{value}</strong></div>;
}

function OptimiserMetric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return <div className="optimiserMetric"><div>{icon}<span>{label}</span></div><strong>{value}</strong><small>{detail}</small></div>;
}

function InstallView({ data, copy, refresh }: { data: ControlRoomPayload; copy: (value: string, label: string) => Promise<void>; refresh: () => Promise<void> }) {
  const config = data.installConfigs.universal ?? "";
  const ownerInstall = data.installProfiles[0];

  async function resetInstallApproval() {
    if (!ownerInstall) {
      return;
    }
    await fetch(`/api/install-profiles/${ownerInstall.id}/disconnect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ admin: "admin" })
    });
    await refresh();
  }

  return (
    <section className="installPage">
      <div className="pageHeader">
        <div>
          <h1>Install Gateway</h1>
          <p>Install this one MCP endpoint in clients. Downstream tools and policy decisions stay centralized here.</p>
        </div>
        <div className="installActions">
          <button onClick={refresh}><RefreshCw size={16} />Refresh</button>
          <button className="primary" onClick={() => copy(config, "Install config")}><Clipboard size={16} />Copy config</button>
        </div>
      </div>

      <div className="installGrid">
        <div className="installCard installStatusCard">
          <div className="panelTitleRow">
            <div>
              <span className="sectionLabel">MCP install status</span>
              <h2>{ownerInstall?.name ?? "Owner install"}</h2>
            </div>
            <StatusBadge status={ownerInstall?.approvalStatus ?? "not_started"} />
          </div>
          <div className="installHealth">
            <ShieldCheck size={22} />
            <div>
              <strong>{installStatusCopy(ownerInstall?.approvalStatus ?? "not_started")}</strong>
              <span>{ownerInstall?.approvalId ? `Approval ${ownerInstall.approvalId}` : `Token ${ownerInstall?.tokenPreview ?? "not generated"}`}</span>
            </div>
          </div>
          <div className="installMetaGrid">
            <LatestItem label="Gateway URL" value={data.gatewayUrl} mono />
            <LatestItem label="Token" value={ownerInstall?.tokenPreview ?? "not generated"} mono />
            <LatestItem label="Last MCP use" value={ownerInstall?.lastUsedAt ? new Date(ownerInstall.lastUsedAt).toLocaleString() : "Waiting for approved request"} />
            <LatestItem label="Approved at" value={ownerInstall?.approvedAt ? new Date(ownerInstall.approvedAt).toLocaleString() : "Not approved yet"} />
          </div>
          <button className="wide dangerSoft" disabled={!ownerInstall} onClick={resetInstallApproval}>
            <RotateCcw size={16} />Reset install approval
          </button>
        </div>

        <div className="installCard installConfigCard">
          <div className="endpoint large">
            <span>Gateway URL</span>
            <strong>{data.gatewayUrl}</strong>
          </div>
          <pre>{config}</pre>
        </div>
      </div>
    </section>
  );
}

function installStatusCopy(status: InstallProfileSummary["approvalStatus"]) {
  if (status === "active") return "MCP install is active";
  if (status === "pending") return "Install approval is waiting";
  if (status === "rejected") return "Install approval was rejected";
  return "Install must be approved before use";
}

function RegisterServerDrawer({ close, refresh }: { close: () => void; refresh: () => Promise<void> }) {
  const [transport, setTransport] = useState<"http" | "stdio">("http");
  const [form, setForm] = useState({ id: "", name: "", url: "", headers: "", command: "", args: "", env: "" });

  async function register() {
    await fetch("/api/servers/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, transport })
    });
    await refresh();
    close();
  }

  return (
    <div className="drawerBackdrop">
      <aside className="drawer">
        <button className="closeButton" onClick={close}>Close</button>
        <h2>Register MCP Server</h2>
        <p>Add an HTTP or stdio MCP server, then index its tools into the gateway.</p>
        <div className="segmented">
          <button className={transport === "http" ? "selected" : ""} onClick={() => setTransport("http")}><Database size={16} />HTTP</button>
          <button className={transport === "stdio" ? "selected" : ""} onClick={() => setTransport("stdio")}><Terminal size={16} />stdio</button>
        </div>
        <Field label="Server id" value={form.id} onChange={(id) => setForm({ ...form, id })} placeholder="linear" />
        <Field label="Name" value={form.name} onChange={(name) => setForm({ ...form, name })} placeholder="Linear MCP" />
        {transport === "http" ? (
          <>
            <Field label="HTTP URL" value={form.url} onChange={(url) => setForm({ ...form, url })} placeholder="http://localhost:4000/mcp" />
            <TextField label="Headers" value={form.headers} onChange={(headers) => setForm({ ...form, headers })} placeholder="Authorization=Bearer ..." />
          </>
        ) : (
          <>
            <Field label="Command" value={form.command} onChange={(command) => setForm({ ...form, command })} placeholder="node" />
            <TextField label="Arguments" value={form.args} onChange={(args) => setForm({ ...form, args })} placeholder="server.js" />
            <TextField label="Environment" value={form.env} onChange={(env) => setForm({ ...form, env })} placeholder="TOKEN=..." />
          </>
        )}
        <button className="primary wide" onClick={register}>Register server</button>
      </aside>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="field"><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="field"><span>{label}</span><textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}

function AuditTable({ rows }: { rows: AuditRow[] }) {
  return (
    <table>
      <thead><tr><th>Status</th><th>User</th><th>Tool</th><th>Policy Trace</th><th>Action</th><th>Time</th></tr></thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td><StatusBadge status={row.status} /></td>
            <td>{row.user}<small>{row.team}</small></td>
            <td className="mono">{row.tool}</td>
            <td>{row.policy}</td>
            <td>{row.action}</td>
            <td>{timeAgo(row.time)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PolicySelect({ value, onChange }: { value: UiDecision; onChange: (value: UiDecision) => void }) {
  return (
    <select className={`policySelect ${value}`} value={value} onChange={(event) => onChange(event.target.value as UiDecision)}>
      <option value="inherit">Inherit</option>
      <option value="allow">Allow</option>
      <option value="require_approval">Approval</option>
      <option value="deny">Deny</option>
    </select>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: "purple" | "blue" | "orange" | "teal" }) {
  return <div className={`statCard ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function MetricNumber({ label, value }: { label: string; value: number }) {
  return <div className="metricNumber"><strong>{value}</strong><span>{label}</span></div>;
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status === "allowed" ? "success" : status === "blocked" ? "denied" : status;
  const label = normalized === "optimised" ? "Optimised" : normalized.replace("_", " ");
  return <span className={`statusBadge ${normalized}`}>{label}</span>;
}

function PolicyPill({ value, prefix }: { value: UiDecision; prefix?: string }) {
  return <span className="policyPill" style={{ color: policyColor(value), borderColor: `${policyColor(value)}55`, background: `${policyColor(value)}18` }}>{prefix ? `${prefix}: ` : ""}{policyLabel(value)}</span>;
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="emptyState"><Shield size={22} /><strong>{title}</strong><span>{text}</span></div>;
}

function policyColor(value: UiDecision) {
  if (value === "allow") return "#000000";
  if (value === "deny") return "#57534f";
  if (value === "require_approval") return "#777169";
  return "#a59f97";
}

function policyLabel(value: UiDecision) {
  if (value === "require_approval") return "Approval";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function initials(name: string) {
  return name.split(" ").map((part) => part.charAt(0).toUpperCase()).join("").slice(0, 2);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

function tokensSaved(trace: TokenCostOptimisationTrace) {
  return Math.max(0, trace.naiveTokens - trace.optimisedTokens);
}

function formatCompactTokens(value: number) {
  return `${(value / 1000).toFixed(value >= 10000 ? 1 : 1)}k`;
}

function timeAgo(value: string) {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

createRoot(document.getElementById("root")!).render(<App />);
