import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let initialized = false;
let disabledReason: string | null = null;

export function isDatabaseEnabled() {
  return Boolean(process.env.DATABASE_URL) && !disabledReason;
}

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }
  pool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
  });
  return pool;
}

export async function ensureDatabase() {
  if (!isDatabaseEnabled() || initialized) {
    return;
  }
  let client: pg.PoolClient;
  try {
    client = await getPool().connect();
  } catch (error) {
    disabledReason = error instanceof Error ? error.message : "Database connection failed.";
    pool = null;
    console.warn(`DATABASE_URL is configured but unavailable; falling back to file-backed demo state. ${disabledReason}`);
    return;
  }
  try {
    await client.query(`
      create table if not exists gateway_state (
        id text primary key,
        value jsonb not null,
        updated_at timestamptz not null default now()
      )
    `);
    await client.query(`
      create table if not exists gateway_secrets (
        key text primary key,
        value jsonb not null,
        updated_at timestamptz not null default now()
      )
    `);
    initialized = true;
  } finally {
    client.release();
  }
}

export async function readState<T>(id: string) {
  await ensureDatabase();
  if (!isDatabaseEnabled()) {
    return undefined;
  }
  const result = await getPool().query("select value from gateway_state where id = $1", [id]);
  return result.rows[0]?.value as T | undefined;
}

export async function writeState(id: string, value: unknown) {
  await ensureDatabase();
  if (!isDatabaseEnabled()) {
    return;
  }
  await getPool().query(
    `
      insert into gateway_state (id, value, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (id)
      do update set value = excluded.value, updated_at = now()
    `,
    [id, JSON.stringify(value)]
  );
}

export async function deleteState(id: string) {
  await ensureDatabase();
  if (!isDatabaseEnabled()) {
    return;
  }
  await getPool().query("delete from gateway_state where id = $1", [id]);
}

export async function readSecret<T>(key: string) {
  await ensureDatabase();
  if (!isDatabaseEnabled()) {
    return undefined;
  }
  const result = await getPool().query("select value from gateway_secrets where key = $1", [key]);
  return result.rows[0]?.value as T | undefined;
}

export async function writeSecret(key: string, value: unknown) {
  await ensureDatabase();
  if (!isDatabaseEnabled()) {
    return;
  }
  await getPool().query(
    `
      insert into gateway_secrets (key, value, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (key)
      do update set value = excluded.value, updated_at = now()
    `,
    [key, JSON.stringify(value)]
  );
}

export async function clearSecrets() {
  await ensureDatabase();
  if (!isDatabaseEnabled()) {
    return;
  }
  await getPool().query("delete from gateway_secrets");
}
