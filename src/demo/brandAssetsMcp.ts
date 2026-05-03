import { stdin, stdout } from "node:process";

interface JsonRpcRequest {
  id?: string | number;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
}

const brandKit = {
  brand: "MCP Gateway",
  voice: "Clear, trustworthy, and pragmatic.",
  colors: [
    { name: "Gateway Purple", hex: "#7C3AED", usage: "Primary actions and product identity." },
    { name: "Signal Teal", hex: "#14B8A6", usage: "Approved and safe states." },
    { name: "Review Orange", hex: "#F97316", usage: "Approval and warning states." },
    { name: "Navy", hex: "#0F172A", usage: "Headlines and high-contrast text." }
  ],
  typography: [
    { name: "Satoshi", usage: "Primary UI and marketing headings." },
    { name: "System sans", usage: "Fallback interface text." }
  ],
  components: [
    { name: "Approval Card", description: "Per-tool decision card with approve/deny controls." },
    { name: "Policy Pill", description: "Compact allow, deny, approval, and inherit state." },
    { name: "Gateway Install Snippet", description: "MCP JSON config with endpoint and bearer token." }
  ],
  assets: [
    { id: "logo-shield-gradient", type: "logo", label: "Gradient shield mark" },
    { id: "portal-hero-card", type: "layout", label: "Client portal hero card" },
    { id: "approval-flow-diagram", type: "diagram", label: "Approval flow diagram" }
  ]
};

let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

stdin.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const parsed = readFramedMessage(buffer);
    if (!parsed) break;
    buffer = parsed.remaining;
    handleMessage(parsed.payload);
  }
});

function handleMessage(payload: string) {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(payload) as JsonRpcRequest;
  } catch {
    return;
  }
  if (request.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "Brand Assets MCP", version: "0.1.0" }
      }
    });
    return;
  }
  if (request.method === "notifications/initialized") {
    return;
  }
  if (request.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        tools: [
          {
            name: "get_brand_kit",
            description: "Return the approved brand kit for portal design work.",
            inputSchema: {
              type: "object",
              properties: {
                clientName: { type: "string" },
                portalGoal: { type: "string" }
              },
              additionalProperties: true
            }
          },
          {
            name: "list_assets",
            description: "List reusable brand assets available to design tools.",
            inputSchema: { type: "object", additionalProperties: true }
          }
        ]
      }
    });
    return;
  }
  if (request.method === "tools/call") {
    const name = request.params?.name;
    const args = request.params?.arguments ?? {};
    if (name === "get_brand_kit") {
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: textResult(JSON.stringify({
          source: "brand-assets-mcp",
          clientName: typeof args.clientName === "string" ? args.clientName : "Demo Client",
          portalGoal: typeof args.portalGoal === "string" ? args.portalGoal : "Create a client portal.",
          brandKit
        }, null, 2))
      });
      return;
    }
    if (name === "list_assets") {
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: textResult(JSON.stringify({
          source: "brand-assets-mcp",
          assets: brandKit.assets
        }, null, 2))
      });
      return;
    }
    send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: `Unknown tool: ${name}` } });
  }
}

function textResult(text: string) {
  return { content: [{ type: "text", text }] };
}

function send(message: unknown) {
  const payload = JSON.stringify(message);
  stdout.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`);
}

function readFramedMessage(current: Buffer<ArrayBufferLike>) {
  const headerEnd = current.indexOf("\r\n\r\n");
  if (headerEnd < 0) return null;
  const header = current.subarray(0, headerEnd).toString("utf8");
  const match = /Content-Length:\s*(\d+)/i.exec(header);
  if (!match) return null;
  const length = Number(match[1]);
  const start = headerEnd + 4;
  const end = start + length;
  if (current.length < end) return null;
  return {
    payload: current.subarray(start, end).toString("utf8"),
    remaining: current.subarray(end)
  };
}
