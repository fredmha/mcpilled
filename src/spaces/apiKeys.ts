import { createHash, timingSafeEqual } from "node:crypto";

export function hashApiKey(apiKey: string) {
  return createHash("sha256").update(apiKey).digest("hex");
}

export function previewApiKey(apiKey: string) {
  return `${apiKey.slice(0, 7)}...${apiKey.slice(-4)}`;
}

export function verifyApiKey(apiKey: string, hash: string) {
  const actual = Buffer.from(hashApiKey(apiKey));
  const expected = Buffer.from(hash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
