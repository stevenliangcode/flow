import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    id             INTEGER PRIMARY KEY,
    started_at     INTEGER NOT NULL,
    ended_at       INTEGER,
    status         TEXT    NOT NULL CHECK (status IN ('running', 'paused', 'stopped')),
    rate_cents     INTEGER NOT NULL,
    last_heartbeat INTEGER NOT NULL,
    auto_paused_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS segments (
    id         INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    start      INTEGER NOT NULL,
    "end"      INTEGER
  );
  CREATE INDEX IF NOT EXISTS segments_session ON segments(session_id);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

/** Opens (and creates if needed) the database. Pass ':memory:' for tests. */
export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}
