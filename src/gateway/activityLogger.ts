import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { nanoid } from "nanoid";
import type { ActivityEntry } from "../shared/types.js";

const DATA_DIR = process.env.MCP_GATEWAY_DATA_DIR ?? "data";
const logPath = join(DATA_DIR, "activity.jsonl");

export async function logActivity(entry: Omit<ActivityEntry, "id" | "createdAt">) {
  await mkdir(dirname(logPath), { recursive: true });
  const payload: ActivityEntry = {
    id: nanoid(),
    createdAt: new Date().toISOString(),
    ...entry
  };
  await appendFile(logPath, `${JSON.stringify(payload)}\n`);
  return payload;
}

export async function readRecentActivity(limit = 50) {
  try {
    const lines = (await readFile(logPath, "utf8")).trim().split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .reverse()
      .map((line) => JSON.parse(line) as ActivityEntry);
  } catch {
    return [];
  }
}
