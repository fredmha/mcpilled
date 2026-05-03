import { spawn } from "node:child_process";
import type { McpServerDefinition, ToolCapability } from "../shared/types.js";
import { classifyTool } from "./governance.js";

interface JsonRpcResponse {
  id?: string | number;
  result?: unknown;
  error?: { message?: string };
}

interface McpToolPayload {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export async function testDownstreamServer(server: McpServerDefinition) {
  await listDownstreamTools("test", "MCP Server", server);
}

export async function listDownstreamTools(serverId: string, serverName: string, server: McpServerDefinition): Promise<ToolCapability[]> {
  const payload = await callDownstream(server, "tools/list", {});
  const tools = isToolList(payload) ? payload.tools : [];
  return tools.map((tool) => ({
    name: tool.name.includes(".") ? tool.name : `${serverId}.${tool.name}`,
    description: tool.description ?? `${serverName}: ${tool.name}`,
    serverId,
    serverName,
    classification: classifyTool(tool.name),
    inputSchema: tool.inputSchema ?? { type: "object", additionalProperties: true }
  }));
}

export async function callDownstreamTool(server: McpServerDefinition, toolName: string, args: Record<string, unknown>) {
  const downstreamName = toolName.includes(".") ? toolName.split(".").slice(1).join(".") : toolName;
  return callDownstream(server, "tools/call", { name: downstreamName, arguments: args });
}

async function callDownstream(server: McpServerDefinition, method: string, params: Record<string, unknown>) {
  if (server.transport === "http") {
    return callHttp(server, method, params);
  }
  return callStdio(server, method, params);
}

async function callHttp(server: McpServerDefinition, method: string, params: Record<string, unknown>) {
  if (!server.url) {
    throw new Error("HTTP MCP server URL is required.");
  }
  const response = await fetch(server.url, {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...server.headers
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params })
  });
  const body = await response.json() as JsonRpcResponse;
  if (!response.ok || body.error) {
    throw new Error(body.error?.message ?? `HTTP MCP call failed with ${response.status}.`);
  }
  return body.result;
}

async function callStdio(server: McpServerDefinition, method: string, params: Record<string, unknown>) {
  if (!server.command) {
    throw new Error("Stdio MCP command is required.");
  }
  const child = spawn(server.command, server.args ?? [], {
    env: { ...process.env, ...server.envMapping },
    shell: process.platform === "win32",
    stdio: ["pipe", "pipe", "pipe"]
  });
  const stderr: string[] = [];
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  const waiters = new Map<string | number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  child.stdout.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const parsed = readFramedMessage(buffer);
      if (!parsed) break;
      buffer = parsed.remaining;
      try {
        const message = JSON.parse(parsed.payload) as JsonRpcResponse;
        if (message.id === undefined) continue;
        const messageId = message.id;
        const waiter = waiters.get(messageId);
        if (!waiter) continue;
        waiters.delete(messageId);
        if (message.error?.message) {
          waiter.reject(new Error(message.error.message));
        } else {
          waiter.resolve(message.result);
        }
      } catch {
        // Ignore malformed child output.
      }
    }
  });
  child.on("error", (error) => {
    for (const waiter of waiters.values()) waiter.reject(error);
    waiters.clear();
  });
  child.on("exit", (code) => {
    if (code && code !== 0) {
      const error = new Error(stderr.join("").trim() || `Stdio MCP exited with code ${code}.`);
      for (const waiter of waiters.values()) waiter.reject(error);
      waiters.clear();
    }
  });
  try {
    const initId = 1;
    sendFramedMessage(child.stdin, {
      jsonrpc: "2.0",
      id: initId,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "mcp-gateway", version: "0.1.0" }
      }
    });
    await waitForResponse(waiters, initId, stderr);
    sendFramedMessage(child.stdin, { jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    const callId = 2;
    sendFramedMessage(child.stdin, { jsonrpc: "2.0", id: callId, method, params });
    return await waitForResponse(waiters, callId, stderr);
  } finally {
    child.kill();
  }
}

function isToolList(value: unknown): value is { tools: McpToolPayload[] } {
  return Boolean(value && typeof value === "object" && Array.isArray((value as { tools?: unknown }).tools));
}

function sendFramedMessage(stdin: NodeJS.WritableStream, message: unknown) {
  const payload = JSON.stringify(message);
  stdin.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`);
}

function waitForResponse(waiters: Map<string | number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>, id: string | number, stderr: string[]) {
  return new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      waiters.delete(id);
      reject(new Error(`Stdio MCP call timed out.${stderr.length ? ` ${stderr.join("").trim()}` : ""}`));
    }, 8000);
    waiters.set(id, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    });
  });
}

function readFramedMessage(buffer: Buffer<ArrayBufferLike>) {
  const headerEnd = buffer.indexOf("\r\n\r\n");
  if (headerEnd < 0) return null;
  const header = buffer.subarray(0, headerEnd).toString("utf8");
  const match = /Content-Length:\s*(\d+)/i.exec(header);
  if (!match) return null;
  const length = Number(match[1]);
  const start = headerEnd + 4;
  const end = start + length;
  if (buffer.length < end) return null;
  return {
    payload: buffer.subarray(start, end).toString("utf8"),
    remaining: buffer.subarray(end)
  };
}
