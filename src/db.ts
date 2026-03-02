import Database from 'better-sqlite3';
import { load } from 'sqlite-vec';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { runMigrations } from './migrations/index.js';

export const DEFAULT_DB_PATH = process.env.ENGRAMDB_DB_PATH ?? join(homedir(), '.global-agent-memory.db');

export function createDb(path: string = DEFAULT_DB_PATH): Database.Database {
  if (path !== ':memory:') {
    mkdirSync(join(path, '..'), { recursive: true });
  }

  const db = new Database(path);

  try {
    load(db);
  } catch (err) {
    throw new Error(
      `[engramdb] Failed to load sqlite-vec extension. Is 'sqlite-vec' installed for your platform?\nOriginal error: ${err}`
    );
  }

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const init = db.transaction(() => {
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

      -- vec0 virtual tables do not support foreign key constraints.
      -- The application layer is responsible for keeping memory_embeddings
      -- in sync with memories (insert/delete must be paired explicitly).
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_embeddings USING vec0(
        id        TEXT PRIMARY KEY,
        embedding float[768]
      );

      -- turn_count is a denormalized counter. Application layer must keep it in sync
      -- with the actual number of rows in conversation_turns.
      CREATE TABLE IF NOT EXISTS conversations (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL,
        agent_id    TEXT NOT NULL,
        title       TEXT,
        summary     TEXT,
        status      TEXT NOT NULL DEFAULT 'open',
        turn_count  INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        closed_at   INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_project_status ON conversations(project_id, status);

      CREATE TABLE IF NOT EXISTS conversation_turns (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role            TEXT NOT NULL,
        content         TEXT NOT NULL,
        turn_index      INTEGER NOT NULL,
        created_at      INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_turns_conversation ON conversation_turns(conversation_id);

      -- sqlite-vec virtual tables do not support FK constraints.
      -- Application layer keeps this in sync with conversations.
      CREATE VIRTUAL TABLE IF NOT EXISTS conversation_embeddings USING vec0(
        id        TEXT PRIMARY KEY,
        embedding float[768]
      );
    `);
  });
  init();
  runMigrations(db);
  return db;
}
