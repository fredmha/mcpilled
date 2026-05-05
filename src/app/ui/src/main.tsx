import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Database,
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

type Page = "servers" | "approvals" | "install";
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
  installProfiles?: Array<{
    id: string;
    name: string;
    tokenPreview: string;
    approvalStatus: "not_started" | "pending" | "active" | "rejected";
    approvalId?: string;
    lastUsedAt?: string;
    approvedAt?: string;
  }>;
}

const navItems: Array<{ page: Page; label: string; icon: React.ReactNode }> = [
  { page: "servers", label: "MCP Servers", icon: <Plug size={18} /> },
  { page: "approvals", label: "Approvals", icon: <ListChecks size={18} /> },
  { page: "install", label: "Install", icon: <KeyRound size={18} /> }
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

function InstallView({ data, copy, refresh }: { data: ControlRoomPayload; copy: (value: string, label: string) => Promise<void>; refresh: () => Promise<void> }) {
  const config = data.installConfigs.universal ?? "";
  const ownerInstall = data.installProfiles?.[0];

  async function disconnectInstall() {
    if (!ownerInstall) return;
    await fetch(`/api/install-profiles/${ownerInstall.id}/disconnect`, { method: "POST" });
    await refresh();
  }

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
        {ownerInstall && (
          <div className="installStatus">
            <div>
              <span>Install approval</span>
              <strong>{ownerInstall.approvalStatus.replace("_", " ")}</strong>
              <small>{ownerInstall.approvalId ? `Approval ${ownerInstall.approvalId}` : `Token ${ownerInstall.tokenPreview}`}</small>
            </div>
            <button onClick={disconnectInstall}><RefreshCw size={16} />Disconnect / replay approval</button>
          </div>
        )}
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
  return <span className={`statusBadge ${normalized}`}>{normalized.replace("_", " ")}</span>;
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
