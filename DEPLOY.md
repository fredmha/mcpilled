# MCP Gateway Deployment

MCP Gateway is hostable as a long-running Node service or a single Docker container.

## Required Runtime

- Node 24 or Docker
- Public HTTPS URL for sharing with Lovable, Cursor, Claude, Codex, or teammates
- `MCP_GATEWAY_SECRET_KEY` for encrypting connector tokens and install tokens

Generate the encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Local Docker

Create `.env` from `.env.example`, set `MCP_GATEWAY_SECRET_KEY`, then run:

```bash
docker compose up --build
```

Open:

```txt
http://localhost:3000
```

## Hosted Deployment

Use a host that supports long-running Node or Docker services. Railway, Render, Fly.io, and a VPS with Docker are better fits than serverless-only hosting.

For the demo in two days, the shortest durable path is Railway with a Postgres plugin:

1. Push this repo to GitHub.
2. Create a Railway project from the GitHub repo.
3. Railway will use `railway.json` and the Dockerfile.
4. Add a Railway Postgres database and copy/provision `DATABASE_URL` into the service.
5. Set the environment variables below.
6. Deploy, then open `/healthz` and the app root.
7. Set `MCP_GATEWAY_PUBLIC_URL` to the final Railway HTTPS URL and redeploy once so the generated install snippet points at the hosted endpoint.

Set these environment variables:

```txt
MCP_GATEWAY_HOST=0.0.0.0
# Omit MCP_GATEWAY_PORT on hosts like Railway/Render that provide PORT.
MCP_GATEWAY_PUBLIC_URL=https://your-domain.example
MCP_GATEWAY_SECRET_KEY=<32-byte-base64-key>
DATABASE_URL=<managed-postgres-url>
DATABASE_SSL=true
```

After deployment, your public Org MCP URL is:

```txt
https://your-domain.example/mcp
```

Health check endpoint:

```txt
https://your-domain.example/healthz
```

Copy the generated install config from Shared Installs and paste it into Lovable, Cursor, Claude, Codex, or another MCP-capable environment.

## Fast Demo Sharing

For a temporary proof of concept, keep the app local and expose it with Cloudflare Tunnel or ngrok:

```bash
cloudflared tunnel --url http://localhost:3000
```

Use the generated HTTPS tunnel URL as the public base URL. A permanent hosted deployment is still required for durable team usage.

## Persistence

When `DATABASE_URL` is set:

- gateway config is stored in `gateway_state`
- encrypted connector/model/install secrets are stored in `gateway_secrets`
- secrets are encrypted before database writes using `MCP_GATEWAY_SECRET_KEY`

When `DATABASE_URL` is not set, the app falls back to local `data/*.json` and `data/*.jsonl` files. The default Docker Compose file uses that file-backed mode with a named volume so it remains a single gateway container with one exposed port.

For hosted demo deployments, prefer Postgres. File-backed mode is fine for local Docker or a VPS with a persistent volume, but many app hosts have ephemeral filesystems and can lose approval/audit/install state after redeploys.

## Hosted Smoke Test

After deploy, test the hosted MCP endpoint before using Lovable:

```bash
curl https://your-domain.example/healthz
curl https://your-domain.example/mcp \
  -H "content-type: application/json" \
  -H "authorization: Bearer <install-token>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke-test","version":"1"}}}'
curl https://your-domain.example/mcp \
  -H "content-type: application/json" \
  -H "authorization: Bearer <install-token>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```
