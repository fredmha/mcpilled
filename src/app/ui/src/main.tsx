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
  Server,
  Shield,
  Terminal,
  XCircle
} from "lucide-react";
import type { ApprovalRequest } from "../../../shared/types";
import "./styles.css";

type Page = "servers" | "approvals" | "install" | "optimiser";
type UiDecision = "allow" | "deny" | "require_approval" | "inherit";
type ToolDecision = "approve" | "deny";

interface Team {
  id: string;
  name: string;
  members: string[];
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

interface ControlRoomPayload {
  gatewayUrl: string;
  stats: {
    servers: number;
    tools: number;
    pendingApprovals: number;
    totalCalls: number;
  };
  teams: Record<string, Team>;
  mcpServers: ControlServer[];
  pendingApprovals: ControlApproval[];
  installConfigs: Record<string, string>;
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
  ignoredFiles: number;
  naiveTokens: number;
  optimisedTokens: number;
  tokenReductionPercent: number;
  estimatedCostBefore: number;
  estimatedCostAfter: number;
  estimatedCostSaved: number;
  status: "optimised";
}

const navItems: Array<{ page: Page; label: string; icon: React.ReactNode }> = [
  { page: "servers", label: "MCP Servers", icon: <Plug size={18} /> },
  { page: "approvals", label: "Approvals", icon: <ListChecks size={18} /> },
  { page: "install", label: "Install", icon: <KeyRound size={18} /> },
  { page: "optimiser", label: "Token Cost Optimiser", icon: <BarChart3 size={18} /> }
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
        {page === "install" && <InstallView data={data} copy={copy} />}
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
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);
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
          expandedTeam={expandedTeam}
          isExpanded={expandedServer === server.id}
          key={server.id}
          onIndex={() => indexServer(server)}
          onSelect={() => setExpandedServer(expandedServer === server.id ? null : server.id)}
          onToggle={() => toggleEnabled(server)}
          onUpdate={(patch) => updateAccess(server, patch)}
          server={server}
          setExpandedTeam={setExpandedTeam}
          teams={data.teams}
        />
      ))}
    </section>
  );
}

function ServerCard({
  server,
  teams,
  onSelect,
  isExpanded,
  expandedTeam,
  setExpandedTeam,
  onUpdate,
  onToggle,
  onIndex
}: {
  server: ControlServer;
  teams: Record<string, Team>;
  onSelect: () => void;
  isExpanded: boolean;
  expandedTeam: string | null;
  setExpandedTeam: (id: string | null) => void;
  onUpdate: (patch: Partial<Pick<ControlServer, "global" | "teams" | "users">>) => void;
  onToggle: () => void;
  onIndex: () => void;
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
              <p>Applies to every team and user unless overridden below.</p>
            </div>
            <PolicySelect value={server.global} onChange={(global) => onUpdate({ global })} />
          </section>

          <section className="accessBlock vertical">
            <div>
              <h3>Team Overrides</h3>
              <p>Team policies override global policy.</p>
            </div>
            <div className="teamPolicyList">
              {Object.entries(server.teams).map(([teamId, decision]) => {
                const team = teams[teamId] ?? { id: teamId, name: teamId, members: [], color: "#64748B" };
                const teamOpen = expandedTeam === teamId;
                return (
                  <div className="teamPolicy" key={teamId}>
                    <div className="teamPolicyTop">
                      <button className="teamExpand" onClick={() => setExpandedTeam(teamOpen ? null : teamId)}>
                        {teamOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <strong>{team.name}</strong>
                        <span>{team.members.length} members</span>
                      </button>
                      <PolicySelect value={decision} onChange={(value) => onUpdate({ teams: { ...server.teams, [teamId]: value } })} />
                    </div>
                    {teamOpen && (
                      <div className="memberPolicies">
                        {team.members.map((member) => (
                          <div className="memberPolicy" key={member}>
                            <span className="mono">{member}</span>
                            <PolicySelect value={server.users[member] ?? "inherit"} onChange={(value) => onUpdate({ users: { ...server.users, [member]: value } })} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
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
        <span>Team: {approval.requesterTeam ?? approval.teamId}</span>
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
        <div className="policyHead">Team overrides</div>
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
  const selectedTrace = traces.find((trace) => trace.id === selectedId) ?? traces[0];

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

  if (!selectedTrace) {
    return (
      <section className="tokenPage">
        <div className="dashboardHeader">
          <div className="dashboardTitle">
            <span className="sectionLabel">Workspace index</span>
            <h1>Token Cost Optimiser</h1>
            <p>Request-time context selection and token savings for MCP tool calls.</p>
          </div>
          <button onClick={refreshOptimisations}><RefreshCw size={16} />Refresh</button>
        </div>
        <EmptyState
          title="No request-time optimisation logs yet."
          text="Call an MCP tool from Lovable, Cursor, Claude, or another app to generate a trace."
        />
      </section>
    );
  }

  const maxTokens = Math.max(selectedTrace.naiveTokens, selectedTrace.optimisedTokens);
  const naiveWidth = `${Math.max(4, (selectedTrace.naiveTokens / maxTokens) * 100)}%`;
  const optimisedWidth = `${Math.max(4, (selectedTrace.optimisedTokens / maxTokens) * 100)}%`;

  return (
    <section className="tokenPage">
      <div className="dashboardHeader">
        <div className="dashboardTitle">
          <span className="sectionLabel">Personal Files index</span>
          <h1>Token Cost Optimiser</h1>
          <p>Request-time context selection and token savings for MCP tool calls.</p>
        </div>
        <button onClick={refreshOptimisations}><RefreshCw size={16} />Refresh</button>
      </div>

      <section className="tokenLatest">
        <div className="latestCopy">
          <div className="latestTitleRow">
            <span className="sectionLabel">Latest MCP request optimisation</span>
            <StatusBadge status="optimised" />
          </div>
          <h2>{selectedTrace.requestSummary}</h2>
          <div className="latestMeta">
            <span>App: {selectedTrace.appName}</span>
            <span>Tool called: <strong className="mono">{selectedTrace.toolName}</strong></span>
            <span>Status: Optimised</span>
          </div>
        </div>
        <div className="contextBars">
          <ContextBar label="Naive context" value={selectedTrace.naiveTokens} cost={selectedTrace.estimatedCostBefore} width={naiveWidth} />
          <ContextBar label="Optimised context" value={selectedTrace.optimisedTokens} cost={selectedTrace.estimatedCostAfter} width={optimisedWidth} />
          <p>Reduced context from {formatCompactTokens(selectedTrace.naiveTokens)} tokens to {formatCompactTokens(selectedTrace.optimisedTokens)} tokens.</p>
        </div>
      </section>

      <div className="tokenMetricGrid">
        <OptimiserMetric label="Indexed Files" value={formatNumber(selectedTrace.indexedFiles)} />
        <OptimiserMetric label="Files Selected" value={formatNumber(selectedTrace.selectedFiles.length)} />
        <OptimiserMetric label="Token Reduction" value={`${selectedTrace.tokenReductionPercent}%`} />
        <OptimiserMetric label="Estimated Cost Saved" value={formatCurrency(selectedTrace.estimatedCostSaved)} />
      </div>

      <section className="tokenSplit">
        <div className="tokenPanel">
          <div className="panelTitleRow">
            <div>
              <span className="sectionLabel">Selected context</span>
              <h2>Selected Context Files</h2>
            </div>
            <span className="ignoredBadge">{selectedTrace.ignoredFiles} files ignored</span>
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
                <strong>{formatNumber(file.tokenCount)} tokens</strong>
              </article>
            ))}
          </div>
          <div className="ignoredLine">
            <CheckCircle2 size={16} />
            <span>Ignored irrelevant files: {selectedTrace.ignoredFiles}</span>
          </div>
        </div>

        <div className="tokenPanel costPanel">
          <span className="sectionLabel">Cost savings projection</span>
          <h2>Workspace index selection</h2>
          <div className="costRows">
            <CostRow label="Naive context" value={formatCurrency(selectedTrace.estimatedCostBefore)} />
            <CostRow label="Optimised context" value={formatCurrency(selectedTrace.estimatedCostAfter)} />
            <CostRow label="Saved" value={formatCurrency(selectedTrace.estimatedCostSaved)} strong />
          </div>
          <div className="signalList">
            <span>Searched workspace index</span>
            <span>Selected {selectedTrace.selectedFiles.length} high-signal files</span>
            <span>Ignored {selectedTrace.ignoredFiles} irrelevant files</span>
          </div>
        </div>
      </section>

      <section className="tokenPanel logPanel">
        <div className="panelTitleRow">
          <div>
            <span className="sectionLabel">Request-time optimisation logs</span>
            <h2>Recent MCP optimisation logs</h2>
          </div>
        </div>
        <div className="tokenTableWrap">
          <table className="tokenTable">
            <thead>
              <tr>
                <th>Time</th>
                <th>App</th>
                <th>Tool</th>
                <th>Indexed</th>
                <th>Selected</th>
                <th>Naive Tokens</th>
                <th>Optimised Tokens</th>
                <th>Reduction</th>
                <th>Cost Saved</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {traces.map((trace) => (
                <tr className={trace.id === selectedTrace.id ? "active" : ""} key={trace.id} onClick={() => setSelectedId(trace.id)}>
                  <td>{new Date(trace.createdAt).toLocaleTimeString()}</td>
                  <td>{trace.appName}</td>
                  <td className="mono">{trace.toolName}</td>
                  <td>{formatNumber(trace.indexedFiles)}</td>
                  <td>{formatNumber(trace.selectedFiles.length)}</td>
                  <td>{formatNumber(trace.naiveTokens)}</td>
                  <td>{formatNumber(trace.optimisedTokens)}</td>
                  <td>{trace.tokenReductionPercent}%</td>
                  <td>{formatCurrency(trace.estimatedCostSaved)}</td>
                  <td><StatusBadge status="optimised" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function ContextBar({ label, value, cost, width }: { label: string; value: number; cost: number; width: string }) {
  return (
    <div className="contextBar">
      <div>
        <span>{label}</span>
        <strong>{formatNumber(value)} tokens</strong>
        <em>{formatCurrency(cost)}</em>
      </div>
      <div className="barTrack"><span style={{ width }} /></div>
    </div>
  );
}

function OptimiserMetric({ label, value }: { label: string; value: string }) {
  return <div className="optimiserMetric"><span>{label}</span><strong>{value}</strong></div>;
}

function CostRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className={strong ? "costRow strong" : "costRow"}><span>{label}</span><strong>{value}</strong></div>;
}

function InstallView({ data, copy }: { data: ControlRoomPayload; copy: (value: string, label: string) => Promise<void> }) {
  const config = data.installConfigs.universal ?? "";
  return (
    <section className="installPage">
      <div className="pageHeader">
        <div>
          <h1>Install Gateway</h1>
          <p>Install this one MCP endpoint in clients. Downstream tools and policy decisions stay centralized here.</p>
        </div>
        <button className="primary" onClick={() => copy(config, "Install config")}><Clipboard size={16} />Copy config</button>
      </div>
      <div className="installCard">
        <div className="endpoint large">
          <span>Gateway URL</span>
          <strong>{data.gatewayUrl}</strong>
        </div>
        <pre>{config}</pre>
      </div>
    </section>
  );
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

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatCurrency(value: number) {
  return `$${value.toFixed(2)}`;
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
