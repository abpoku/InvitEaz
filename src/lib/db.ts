import { Pool } from "pg";
import fs from "fs";
import path from "path";

declare global {
  // eslint-disable-next-line no-var
  var __inviteazPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __inviteazSchemaReady: Promise<void> | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Add a Postgres connection string to your environment (see .env.example)."
    );
  }
  return new Pool({
    connectionString,
    // Most managed Postgres providers (Neon, Supabase, Render, etc.) require
    // SSL. sslmode is usually already in the connection string, but this is
    // a safe default for providers that don't set it themselves.
    ssl: connectionString.includes("sslmode=disable") ? false : { rejectUnauthorized: false },
    // Without these, nothing here can ever time out — a wedged connection attempt, a stuck lock
    // (see ensureSchema's advisory lock below), or a runaway query all just hang forever, and on
    // Vercel that means every request blocks until the platform force-kills it at the function's
    // max duration, taking the whole site down with it. These bound every wait to single-digit
    // seconds instead, so the worst case is one fast failure (retried on the next request) rather
    // than a multi-minute outage. Comfortably above any legitimate query this app runs.
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
    lock_timeout: 10_000,
    idle_in_transaction_session_timeout: 20_000,
    // statement_timeout/lock_timeout are enforced by Postgres itself, so they only help once a
    // query actually reaches the server. A pooled connection can also go silently dead — no clean
    // close, just a black hole (a network blip, Neon's proxy dropping it during maintenance) —
    // and a query sent over it then waits forever for a reply the server never even received,
    // which none of the settings above can catch. query_timeout is enforced client-side instead:
    // the pg library itself gives up after this long regardless of what the server does or
    // doesn't do. keepAlive makes that scenario rarer in the first place by having the OS
    // periodically probe idle connections, so a dead one is more likely to be caught and closed
    // before it's ever handed back out of the pool.
    query_timeout: 20_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });
}

export function getPool(): Pool {
  if (!global.__inviteazPool) {
    global.__inviteazPool = createPool();
  }
  return global.__inviteazPool;
}

// Arbitrary fixed key for the schema-migration advisory lock — just needs to be unique to this
// purpose within the database; nothing else in the app takes advisory locks.
const SCHEMA_MIGRATION_LOCK_KEY = 727001727001;

/** Runs schema.sql (idempotent — CREATE TABLE/INDEX IF NOT EXISTS) once per process — but on
 * serverless, "once per process" doesn't mean "once overall": a deploy or a traffic burst spins
 * up many independent processes at once, each racing to run this same multi-statement DDL script
 * (one implicit transaction) against the same database. Two such transactions touching
 * overlapping tables in different orders can deadlock Postgres outright — this happened in
 * production. A session-held advisory lock serializes them: only one instance actually applies
 * the schema at a time, everyone else just waits (briefly, since a no-op re-run is fast) and then
 * finds it already done — no concurrent DDL, no deadlock.
 *
 * That wait is bounded by the pool's lock_timeout (see createPool) — if the lock holder ever dies
 * without releasing it (another production incident: a function killed mid-hold left the lock
 * orphaned, and every other instance's pg_advisory_lock call blocked forever with nothing to time
 * it out, hanging the entire site until Vercel force-killed each request at its max duration), this
 * throws instead of hanging, the promise below rejects, and the next call just retries. */
function ensureSchema(): Promise<void> {
  if (!global.__inviteazSchemaReady) {
    global.__inviteazSchemaReady = (async () => {
      const schemaPath = path.join(process.cwd(), "src", "lib", "schema.sql");
      const schema = fs.readFileSync(schemaPath, "utf-8");
      const client = await getPool().connect();
      try {
        await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_MIGRATION_LOCK_KEY]);
        try {
          await client.query(schema);
        } finally {
          await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_MIGRATION_LOCK_KEY]);
        }
      } finally {
        client.release();
      }
    })();
    // Never leave this process permanently broken from one failed attempt (e.g. a transient
    // deadlock elsewhere, or a real schema bug) — let the next call retry from scratch instead of
    // reusing a rejected promise forever. Callers already awaiting this particular attempt still
    // see it reject normally; this only affects what happens on the *next* call.
    global.__inviteazSchemaReady.catch(() => { global.__inviteazSchemaReady = undefined; });
  }
  return global.__inviteazSchemaReady;
}

/** Run a query, converting `?` placeholders (kept from the original SQLite
 * query text throughout the model files) into Postgres's `$1, $2...` style,
 * and returns the row array — matching the shape callers already expect.
 */
export async function query<T = any>(text: string, params: any[] = []): Promise<T[]> {
  await ensureSchema();
  let i = 0;
  const pgText = text.replace(/\?/g, () => `$${++i}`);
  const result = await getPool().query(pgText, params);
  return result.rows as T[];
}

export async function queryOne<T = any>(text: string, params: any[] = []): Promise<T | undefined> {
  const rows = await query<T>(text, params);
  return rows[0];
}

export async function exec(text: string, params: any[] = []): Promise<number> {
  await ensureSchema();
  let i = 0;
  const pgText = text.replace(/\?/g, () => `$${++i}`);
  const result = await getPool().query(pgText, params);
  return result.rowCount ?? 0;
}
