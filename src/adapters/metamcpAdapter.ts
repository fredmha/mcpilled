import type { Request } from "express";

export async function forwardToMetaMcp(req: Request) {
  const upstream = process.env.METAMCP_UPSTREAM_URL;
  if (!upstream) {
    return null;
  }
  const response = await fetch(upstream, {
    method: req.method,
    headers: {
      "content-type": "application/json",
      authorization: req.header("authorization") ?? ""
    },
    body: req.method === "GET" ? undefined : JSON.stringify(req.body)
  });
  return {
    status: response.status,
    body: await response.text(),
    contentType: response.headers.get("content-type") ?? "application/json"
  };
}
