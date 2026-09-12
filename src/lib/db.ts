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
  });
}

export function getPool(): Pool {
  if (!global.__inviteazPool) {
    global.__inviteazPool = createPool();
  }
  return global.__inviteazPool;
}

/** Runs schema.sql (idempotent — CREATE TABLE/INDEX IF NOT EXISTS) once per process. */
function ensureSchema(): Promise<void> {
  if (!global.__inviteazSchemaReady) {
    global.__inviteazSchemaReady = (async () => {
      const schemaPath = path.join(process.cwd(), "src", "lib", "schema.sql");
      const schema = fs.readFileSync(schemaPath, "utf-8");
      await getPool().query(schema);
    })();
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
