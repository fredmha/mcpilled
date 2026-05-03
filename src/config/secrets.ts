import { readFile, writeFile } from "node:fs/promises";
import { decryptJson, encryptJson } from "./encryption.js";
import { keyPath, secretsPath } from "./store.js";
import { isDatabaseEnabled, readSecret, writeSecret } from "./database.js";

type SecretStore = Record<string, Record<string, string>>;
type EncryptedPayload = { iv: string; tag: string; data: string };

async function loadSecrets() {
  try {
    const encrypted = JSON.parse(await readFile(secretsPath, "utf8")) as { iv: string; tag: string; data: string };
    return decryptJson<SecretStore>(keyPath, encrypted);
  } catch {
    return {};
  }
}

export async function saveConnectorCredentials(spaceId: string, connectorId: string, credentials: Record<string, string>) {
  await saveSecret(`connector:${spaceId}:${connectorId}`, credentials);
}

export async function getConnectorCredentials(spaceId: string, connectorId: string) {
  return getSecret(`connector:${spaceId}:${connectorId}`);
}

export async function saveSecret(key: string, value: Record<string, string>) {
  if (isDatabaseEnabled()) {
    await writeSecret(key, await encryptJson(keyPath, value));
    return;
  }
  const secrets = await loadSecrets();
  secrets[key] = value;
  const encrypted = await encryptJson(keyPath, secrets);
  await writeFile(secretsPath, `${JSON.stringify(encrypted, null, 2)}\n`, { mode: 0o600 });
}

export async function getSecret(key: string) {
  if (isDatabaseEnabled()) {
    const encrypted = await readSecret<EncryptedPayload>(key);
    return encrypted ? decryptJson<Record<string, string>>(keyPath, encrypted) : {};
  }
  const secrets = await loadSecrets();
  return secrets[key] ?? {};
}
