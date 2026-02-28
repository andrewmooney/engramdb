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
    db.close();
  });
});
