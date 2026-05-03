import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const ALGORITHM = "aes-256-gcm";

async function getOrCreateKey(keyPath: string) {
  if (process.env.MCP_GATEWAY_SECRET_KEY) {
    return Buffer.from(process.env.MCP_GATEWAY_SECRET_KEY, "base64");
  }
  await mkdir(dirname(keyPath), { recursive: true });
  try {
    return Buffer.from(await readFile(keyPath, "utf8"), "base64");
  } catch {
    const key = randomBytes(32);
    await writeFile(keyPath, key.toString("base64"), { mode: 0o600 });
    return key;
  }
}

export async function encryptJson(keyPath: string, value: unknown) {
  const key = await getOrCreateKey(keyPath);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64")
  };
}

export async function decryptJson<T>(keyPath: string, payload: { iv: string; tag: string; data: string }) {
  const key = await getOrCreateKey(keyPath);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.data, "base64")),
    decipher.final()
  ]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}
