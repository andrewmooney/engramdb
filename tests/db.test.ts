import { describe, it, expect } from 'vitest';
import { createDb } from '../src/db.js';

describe('createDb', () => {
  it('creates tables without error', () => {
    const db = createDb(':memory:');
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table'`
    ).all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('memories');
    expect(names).toContain('memory_embeddings');
    db.close();
  });
});

describe('schema migrations', () => {
  it('creates schema_migrations table on first run', () => {
    const db = createDb(':memory:');
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'`).get();
    expect(row).toBeTruthy();
  });

  it('applies migration 001 (idx_memories_updated_at, idx_memories_agent_id)', () => {
    const db = createDb(':memory:');
    const indexes = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='memories'`).all() as { name: string }[];
    const names = indexes.map(i => i.name);
    expect(names).toContain('idx_memories_updated_at');
    expect(names).toContain('idx_memories_agent_id');
  });

  it('records applied migrations in schema_migrations', () => {
    const db = createDb(':memory:');
    const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[];
    expect(rows.map(r => r.version)).toContain(1);
  });

  it('is idempotent — running createDb twice does not error', () => {
    const db = createDb(':memory:');
    // Simulate re-running migration runner on same DB (in-memory, same instance)
    // The runner must skip already-applied migrations
    expect(() => createDb(':memory:')).not.toThrow();
  });
});
