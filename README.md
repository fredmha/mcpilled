# MCP Gateway Demo

MCP Gateway is a demo control plane for governing MCP tool access. It exposes one MCP endpoint for AI clients such as Lovable, queues approval requests for sensitive tool calls, and gives an admin UI for approving or denying tools per request.

The current demo story is:

1. Lovable calls `client_portal.create`.
2. The gateway creates one bundled approval request.
3. The request includes:
   - `hubspot.search_contacts`, mocked and denied because it contains customer CRM data.
   - `supabase_db.query`, mocked and denied because it contains production customer data.
   - `brand_assets.get_brand_kit`, backed by a real local stdio MCP server and approved for safe brand context.
4. The approval audit shows HubSpot and Supabase blocked, and Brand Assets executed.

## Tech Stack

- Node 24
- Express 5
- TypeScript
- React 19
- Vite
- Optional Postgres persistence
- Docker/Railway deployment support

## Repo Map

```text
src/server.ts                  Express app, REST API, static UI serving
src/gateway/mcpEndpoint.ts      Public MCP JSON-RPC endpoint at /mcp
src/gateway/toolRouter.ts       Tool routing, demo workflow, mocked executions
src/gateway/governance.ts       Policies, approvals, audit log
src/gateway/downstreamMcp.ts    HTTP/stdio downstream MCP client
src/demo/brandAssetsMcp.ts      Real stdio MCP server for brand kit data
src/config/store.ts             Config loading, default demo connectors, port handling
src/config/database.ts          Optional Postgres state/secrets storage
src/app/ui/src/main.tsx         React admin UI
src/app/ui/src/styles.css       UI styles
Dockerfile                      Production container
railway.json                    Railway deploy config
DEPLOY.md                       Deployment notes and smoke tests
```

## Local Setup

Install dependencies:

```bash
npm install
```

Run checks:

```bash
npm run typecheck
npm run build
```

Run locally:

```bash
npm run dev
```

By default the app uses local file-backed state under `data/`. Open:

```text
http://localhost:3000
```

If port `3000` is busy:

```bash
MCP_GATEWAY_PORT=8080 npm run dev
```

On PowerShell:

```powershell
$env:MCP_GATEWAY_PORT="8080"
npm run dev
```

## Production Start

Build and start:

```bash
npm run build
npm start
```

Health check:

```text
GET /healthz
```

Expected response:

```json
{"ok":true,"status":"running"}
```

## Important Environment Variables

```text
PORT                     Platform-provided runtime port. Railway sets this automatically.
MCP_GATEWAY_PORT          Local/manual port override. PORT takes precedence when both are set.
MCP_GATEWAY_HOST          Bind host. Use 0.0.0.0 in containers.
MCP_GATEWAY_PUBLIC_URL    Public app URL used when generating install snippets.
MCP_GATEWAY_SECRET_KEY    32-byte base64 key for encrypting secrets.
DATABASE_URL              Optional Postgres URL for persistent hosted state.
DATABASE_SSL              Set true for hosted Postgres providers that require SSL.
```

Generate a secret key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Port priority is intentional:

```text
PORT -> MCP_GATEWAY_PORT -> 3000
```

This matters on Railway because healthchecks target Railway's assigned `PORT`.

## Railway Deploy

1. Create a Railway service from the GitHub repo.
2. Railway should detect `Dockerfile` and `railway.json`.
3. Add a Postgres service if persistence is needed.
4. Set variables on the app service:

```text
MCP_GATEWAY_HOST=0.0.0.0
MCP_GATEWAY_SECRET_KEY=<32-byte-base64-key>
DATABASE_URL=<Railway Postgres URL or variable reference>
DATABASE_SSL=true
```

Do not set `MCP_GATEWAY_PORT` on Railway unless there is a specific reason. If it is set, `PORT` still wins.

After Railway gives the app a public domain, set:

```text
MCP_GATEWAY_PUBLIC_URL=https://your-app.up.railway.app
```

Redeploy once after setting `MCP_GATEWAY_PUBLIC_URL`, so the Install Gateway snippet points at the public hosted endpoint.

## MCP Client Config

Use the Install Gateway tab in the UI for the current token and URL. The generated config looks like:

```json
{
  "mcpServers": {
    "org-mcp": {
      "url": "https://your-app.up.railway.app/mcp",
      "headers": {
        "Authorization": "Bearer <install-token>"
      }
    }
  }
}
```

For Lovable, paste that MCP config. The important endpoint is:

```text
https://your-app.up.railway.app/mcp
```

## MCP Smoke Tests

Initialize:

```bash
curl https://your-app.up.railway.app/mcp \
  -H "content-type: application/json" \
  -H "authorization: Bearer <install-token>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke-test","version":"1"}}}'
```

List tools:

```bash
curl https://your-app.up.railway.app/mcp \
  -H "content-type: application/json" \
  -H "authorization: Bearer <install-token>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

Trigger the demo workflow:

```bash
curl https://your-app.up.railway.app/mcp \
  -H "content-type: application/json" \
  -H "authorization: Bearer <install-token>" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"client_portal.create","arguments":{"clientName":"Northwind Health","portalGoal":"Build an internal client portal using CRM context, production usage data, and approved brand kit assets."}}}'
```

Then open the UI, go to Approvals, deny HubSpot, deny Supabase DB, and approve Brand Assets MCP.

## Main REST Endpoints

```text
GET  /healthz
GET  /api/control-room
GET  /api/approvals
POST /api/approvals/:id/tool-decisions
POST /api/demo/run
POST /api/demo/reset
POST /api/servers/:id/index
POST /mcp
```

Bundled approval decisions use:

```json
{
  "decisions": {
    "hubspot.search_contacts": "deny",
    "supabase_db.query": "deny",
    "brand_assets.get_brand_kit": "approve"
  },
  "admin": "demo-admin"
}
```

## Demo Tools

```text
client_portal.create
hubspot.search_contacts
supabase_db.query
brand_assets.get_brand_kit
brand_assets.list_assets
```

`brand_assets.*` is the real MCP-backed demo server. It runs from:

```text
dist/demo/brandAssetsMcp.js
```

The TypeScript source is:

```text
src/demo/brandAssetsMcp.ts
```

## Persistence

Without `DATABASE_URL`, state is stored in local files:

```text
data/gateway.json
data/policies.json
data/approvals.json
data/audit.jsonl
data/activity.jsonl
data/secrets.json
```

With `DATABASE_URL`, config and encrypted secrets are stored in Postgres tables:

```text
gateway_state
gateway_secrets
```

If Postgres is unreachable, the app logs a warning and falls back to file-backed demo state so `/healthz` can still pass.

## Troubleshooting

Healthcheck fails with service unavailable:

- Check deploy logs for `MCP Gateway running at http://localhost:<port>`.
- On Railway, the port should be Railway's assigned `PORT`, not necessarily `3000`.
- Remove stale `MCP_GATEWAY_PORT` unless needed.
- Confirm `PORT` has priority over `MCP_GATEWAY_PORT` in `src/config/store.ts`.

Lovable says invalid install token:

- Use the token from the Install Gateway tab.
- If Lovable has a Bearer token field, paste only the token without the `Bearer` prefix.
- If Lovable accepts headers, use `Authorization: Bearer <install-token>`.

Lovable says `protocolVersion` is invalid or missing:

- Confirm the deployed commit includes `src/gateway/mcpEndpoint.ts` initialize support.
- Smoke test `initialize` with curl.

Brand Assets MCP does not execute:

- Run `npm run build`; the stdio server runs from `dist/demo/brandAssetsMcp.js`.
- Confirm `brand_assets` is enabled and indexed in the MCP Servers UI.

Database errors on Railway:

- Confirm `DATABASE_URL` is attached to the app service, not only the Postgres service.
- Set `DATABASE_SSL=true`.
- The app can fall back to local state for the demo, but persistence across redeploys needs Postgres.

## Development Notes

- Keep generated files out of git: `node_modules`, `dist`, `data`, and logs are ignored.
- Use `npm run typecheck` and `npm run build` before pushing.
- The frontend is intentionally limited to MCP Servers, Approvals, and Install Gateway for the demo.
- Policies are shown inside expanded MCP server cards.
- The intended approval demo is bundled per-tool review, not three separate MCP calls.
