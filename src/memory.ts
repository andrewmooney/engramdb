import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { Memory, MemoryType, MemoryWithScore } from './types.js';

const W_SIM    = parseFloat(process.env.MTMEM_W_SIM    ?? '') || 0.6;
const W_IMP    = parseFloat(process.env.MTMEM_W_IMP    ?? '') || 0.25;
const W_REC    = parseFloat(process.env.MTMEM_W_REC    ?? '') || 0.15;
const LAMBDA   = parseFloat(process.env.MTMEM_DECAY_LAMBDA ?? '') || 0.01;

export function recencyDecay(lastAccessedAt: number, now: number): number {
  const daysSince = (now - lastAccessedAt) / (1000 * 60 * 60 * 24);
  return Math.exp(-LAMBDA * daysSince);
}

export function computeScore(params: {
  similarity: number;
  importance: number;
  lastAccessedAt: number;
  now: number;
}): number {
  const { similarity, importance, lastAccessedAt, now } = params;
  return (
    W_SIM * similarity +
    W_IMP * importance +
    W_REC * recencyDecay(lastAccessedAt, now)
  );
}

export function insertMemory(
  db: Database.Database,
  params: {
    project_id: string;
    agent_id: string;
    type: MemoryType;
    content: string;
    importance: number;
    embedding: Float32Array;
  }
): { id: string; created_at: number } {
  const id = uuidv4();
  const now = Date.now();

  const doInsert = db.transaction(() => {
    db.prepare(`
      INSERT INTO memories (id, project_id, agent_id, type, content, importance,
                            access_count, created_at, updated_at, last_accessed_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(id, params.project_id, params.agent_id, params.type, params.content,
           params.importance, now, now, now);

    db.prepare(`
      INSERT INTO memory_embeddings (id, embedding) VALUES (?, ?)
    `).run(id, params.embedding);
  });

  doInsert();

  return { id, created_at: now };
}

export function queryMemories(
  db: Database.Database,
  params: {
    embedding: Float32Array;
    project_id?: string;
    type?: MemoryType;
    agent_id?: string;
    limit: number;
  }
): MemoryWithScore[] {
  const now = Date.now();

  // Get top candidates from vector search (2x limit for re-scoring)
  const candidates = db.prepare(`
    SELECT id, distance
    FROM memory_embeddings
    WHERE embedding MATCH ?
    AND k = ?
    ORDER BY distance
  `).all(params.embedding, params.limit * 2) as { id: string; distance: number }[];

  if (candidates.length === 0) return [];

  const placeholders = candidates.map(() => '?').join(',');
  let query = `SELECT * FROM memories WHERE id IN (${placeholders})`;
  const args: unknown[] = candidates.map(c => c.id);

  if (params.project_id) { query += ' AND project_id = ?'; args.push(params.project_id); }
  if (params.type)       { query += ' AND type = ?';       args.push(params.type); }
  if (params.agent_id)   { query += ' AND agent_id = ?';   args.push(params.agent_id); }

  const rows = (db.prepare(query).all as (...a: unknown[]) => Memory[])(...args);

  const distanceMap = new Map(candidates.map(c => [c.id, c.distance]));

  const scored = rows.map(row => {
    const distance = distanceMap.get(row.id) ?? 1;
    // For unit-normalized vectors, L2 distance and cosine similarity are related by:
    //   cosine_similarity = 1 - (L2² / 2)
    // Using `1 - distance` would be incorrect; squaring the distance gives the right conversion.
    const similarity = 1 - (distance * distance) / 2;
    return {
      ...row,
      score: computeScore({ similarity, importance: row.importance, lastAccessedAt: row.last_accessed_at, now }),
    };
  });

  // Sort descending, take limit
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, params.limit);

  // Update access metadata
  const updateStmt = db.prepare(`
    UPDATE memories SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?
  `);
  for (const m of top) updateStmt.run(now, m.id);

  return top;
}

export function updateMemory(
  db: Database.Database,
  id: string,
  fields: { content?: string; importance?: number; type?: MemoryType; embedding?: Float32Array }
): { id: string; updated_at: number } | null {
  const existing = db.prepare('SELECT id FROM memories WHERE id = ?').get(id);
  if (!existing) return null;

  const now = Date.now();
  const sets: string[] = ['updated_at = ?'];
  const args: unknown[] = [now];

  if (fields.content    !== undefined) { sets.push('content = ?');    args.push(fields.content); }
  if (fields.importance !== undefined) { sets.push('importance = ?'); args.push(fields.importance); }
  if (fields.type       !== undefined) { sets.push('type = ?');       args.push(fields.type); }

  args.push(id);

  const doUpdate = db.transaction(() => {
    (db.prepare(`UPDATE memories SET ${sets.join(', ')} WHERE id = ?`).run as (...a: unknown[]) => void)(...args);

    if (fields.embedding) {
      db.prepare('UPDATE memory_embeddings SET embedding = ? WHERE id = ?')
        .run(fields.embedding, id);
    }
  });

  doUpdate();

  return { id, updated_at: now };
}

export function listProjects(db: Database.Database) {
  return db.prepare(`
    SELECT project_id,
           COUNT(*) as memory_count,
           MAX(updated_at) as last_updated_at
    FROM memories
    GROUP BY project_id
    ORDER BY last_updated_at DESC
  `).all() as { project_id: string; memory_count: number; last_updated_at: number }[];
}
