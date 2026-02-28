import Database from 'better-sqlite3';
import { load } from 'sqlite-vec';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';

export const DEFAULT_DB_PATH = join(homedir(), '.global-agent-memory.db');

export function createDb(path: string = DEFAULT_DB_PATH): Database.Database {
  if (path !== ':memory:') {
    mkdirSync(join(path, '..'), { recursive: true });
  }

  const db = new Database(path);
  load(db);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id               TEXT PRIMARY KEY,
      project_id       TEXT NOT NULL,
      agent_id         TEXT NOT NULL,
      type             TEXT NOT NULL,
      content          TEXT NOT NULL,
      importance       REAL NOT NULL DEFAULT 0.5,
      access_count     INTEGER NOT NULL DEFAULT 0,
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL,
      last_accessed_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id);
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_embeddings USING vec0(
      id        TEXT PRIMARY KEY,
      embedding float[768]
    );
  `);

  return db;
}
