import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

// A single, process-wide SQLite connection. In serverless/production
// environments, point DATABASE_FILE at a persistent volume (Railway,
// Render, Fly, a VPS, etc.) — see README for Postgres migration notes.
const DB_PATH = process.env.DATABASE_FILE || path.join(process.cwd(), "data", "inviteaz.db");

declare global {
  // eslint-disable-next-line no-var
  var __inviteazDb: Database.Database | undefined;
}

function createConnection(): Database.Database {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schemaPath = path.join(process.cwd(), "src", "lib", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");
  db.exec(schema);

  return db;
}

export function getDb(): Database.Database {
  if (!global.__inviteazDb) {
    global.__inviteazDb = createConnection();
  }
  return global.__inviteazDb;
}
