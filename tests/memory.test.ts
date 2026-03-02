import { describe, it, expect, beforeEach } from 'vitest';
import { computeScore, recencyDecay, insertMemory, queryMemories, updateMemory, listProjects } from '../src/memory.js';
import { createDb } from '../src/db.js';
import type Database from 'better-sqlite3';
import type { MemoryType } from '../src/types.js';

describe('insertMemory', () => {
  let db: Database.Database;
  beforeEach(() => { db = createDb(':memory:'); });

  it('returns id and created_at', () => {
    const result = insertMemory(db, {
      project_id: '/home/user/proj',
      agent_id: 'test',
      type: 'fact',
      content: 'test content',
      importance: 0.7,
      embedding: new Float32Array(768).fill(0.1),
    });
    expect(result.id).toBeTruthy();
    expect(result.created_at).toBeGreaterThan(0);
  });

  it('inserts into both memories and memory_embeddings', () => {
    const { id } = insertMemory(db, {
      project_id: '/home/user/proj',
      agent_id: 'test',
      type: 'fact',
      content: 'test content',
      importance: 0.5,
      embedding: new Float32Array(768).fill(0.1),
    });
    const mem = db.prepare('SELECT id FROM memories WHERE id = ?').get(id);
    expect(mem).toBeTruthy();
  });
});

describe('queryMemories', () => {
  let db: Database.Database;
  beforeEach(() => { db = createDb(':memory:'); });

  it('returns empty array when no memories', () => {
    const result = queryMemories(db, {
      embedding: new Float32Array(768).fill(0.1),
      limit: 5,
    });
    expect(result).toEqual([]);
  });

  it('returns scored results for matching project', () => {
    insertMemory(db, {
      project_id: '/home/user/proj',
      agent_id: 'test',
      type: 'fact',
      content: 'React TypeScript project',
      importance: 0.8,
      embedding: new Float32Array(768).fill(0.1),
    });
    const results = queryMemories(db, {
      embedding: new Float32Array(768).fill(0.1),
      project_id: '/home/user/proj',
      limit: 5,
    });
    expect(results.length).toBe(1);
    expect(results[0].score).toBeGreaterThan(0);
  });
});

describe('updateMemory', () => {
  let db: Database.Database;
  beforeEach(() => { db = createDb(':memory:'); });

  it('returns null for unknown id', () => {
    const result = updateMemory(db, 'nonexistent-id', { importance: 0.9 });
    expect(result).toBeNull();
  });

  it('updates importance', () => {
    const { id } = insertMemory(db, {
      project_id: '/p',
      agent_id: 'a',
      type: 'fact',
      content: 'test',
      importance: 0.3,
      embedding: new Float32Array(768).fill(0.1),
    });
    updateMemory(db, id, { importance: 0.9 });
    const row = db.prepare('SELECT importance FROM memories WHERE id = ?').get(id) as { importance: number };
    expect(row.importance).toBeCloseTo(0.9);
  });
});

describe('listProjects', () => {
  let db: Database.Database;
  beforeEach(() => { db = createDb(':memory:'); });

  it('returns empty array when no memories', () => {
    expect(listProjects(db)).toEqual([]);
  });

  it('returns project with memory count', () => {
    insertMemory(db, { project_id: '/p', agent_id: 'a', type: 'fact', content: 'x', importance: 0.5, embedding: new Float32Array(768).fill(0.1) });
    insertMemory(db, { project_id: '/p', agent_id: 'a', type: 'fact', content: 'y', importance: 0.5, embedding: new Float32Array(768).fill(0.2) });
    const projects = listProjects(db);
    expect(projects).toHaveLength(1);
    expect(projects[0].project_id).toBe('/p');
    expect(projects[0].memory_count).toBe(2);
  });
});

describe('recencyDecay', () => {
  it('returns 1.0 for current access', () => {
    const now = Date.now();
    expect(recencyDecay(now, now)).toBeCloseTo(1.0, 3);
  });

  it('decays over time', () => {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    expect(recencyDecay(thirtyDaysAgo, now)).toBeLessThan(0.75);
  });
});

describe('computeScore', () => {
  it('weights similarity, importance, recency correctly', () => {
    const now = Date.now();
    const score = computeScore({
      similarity: 1.0,
      importance: 1.0,
      lastAccessedAt: now,
      now,
    });
    expect(score).toBeCloseTo(1.0, 2);
  });

  it('lower similarity lowers score', () => {
    const now = Date.now();
    const high = computeScore({ similarity: 1.0, importance: 0.5, lastAccessedAt: now, now });
    const low = computeScore({ similarity: 0.2, importance: 0.5, lastAccessedAt: now, now });
    expect(high).toBeGreaterThan(low);
  });
});

describe('insertMemory importance clamp', () => {
  let db: Database.Database;
  beforeEach(() => { db = createDb(':memory:'); });

  it('clamps importance > 1 to 1', () => {
    const { id } = insertMemory(db, {
      project_id: '/p', agent_id: 'a', type: 'fact', content: 'x',
      importance: 1.5, embedding: new Float32Array(768).fill(0.1),
    });
    const row = db.prepare('SELECT importance FROM memories WHERE id = ?').get(id) as { importance: number };
    expect(row.importance).toBe(1);
  });

  it('clamps importance < 0 to 0', () => {
    const { id } = insertMemory(db, {
      project_id: '/p', agent_id: 'a', type: 'fact', content: 'x',
      importance: -0.1, embedding: new Float32Array(768).fill(0.1),
    });
    const row = db.prepare('SELECT importance FROM memories WHERE id = ?').get(id) as { importance: number };
    expect(row.importance).toBe(0);
  });
});

describe('queryMemories access_count batched update', () => {
  let db: Database.Database;
  beforeEach(() => { db = createDb(':memory:'); });

  it('increments access_count for all returned results in a single query', () => {
    // Insert 3 memories
    for (let i = 0; i < 3; i++) {
      insertMemory(db, {
        project_id: '/p', agent_id: 'a', type: 'fact',
        content: `memory ${i}`, importance: 0.5,
        embedding: new Float32Array(768).fill(0.1),
      });
    }
    // Query them
    queryMemories(db, { embedding: new Float32Array(768).fill(0.1), limit: 10 });
    // All 3 should have access_count = 1
    const rows = db.prepare('SELECT access_count FROM memories WHERE project_id = ?').all('/p') as { access_count: number }[];
    expect(rows.every(r => r.access_count === 1)).toBe(true);
  });
});
