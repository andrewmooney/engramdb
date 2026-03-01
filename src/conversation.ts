import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { Conversation, ConversationTurn, ConversationWithScore, TurnRole } from './types.js';
import { computeScore } from './memory.js';

export function insertConversation(
  db: Database.Database,
  params: { project_id: string; agent_id: string; title?: string }
): { id: string; created_at: number } {
  const id = uuidv4();
  const now = Date.now();
  db.prepare(`
    INSERT INTO conversations (id, project_id, agent_id, title, status, turn_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'open', 0, ?, ?)
  `).run(id, params.project_id, params.agent_id, params.title ?? null, now, now);
  return { id, created_at: now };
}

export function appendTurn(
  db: Database.Database,
  params: { conversation_id: string; role: TurnRole; content: string }
): { turn_id: string; turn_index: number } {
  const conv = db.prepare('SELECT id, status, turn_count FROM conversations WHERE id = ?')
    .get(params.conversation_id) as { id: string; status: string; turn_count: number } | undefined;

  if (!conv) throw new Error('Conversation not found');
  if (conv.status === 'closed') throw new Error('Conversation is closed');

  const turnId = uuidv4();
  const now = Date.now();
  const turnIndex = conv.turn_count;

  const doAppend = db.transaction(() => {
    db.prepare(`
      INSERT INTO conversation_turns (id, conversation_id, role, content, turn_index, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(turnId, params.conversation_id, params.role, params.content, turnIndex, now);

    db.prepare(`
      UPDATE conversations SET turn_count = turn_count + 1, updated_at = ? WHERE id = ?
    `).run(now, params.conversation_id);
  });

  doAppend();
  return { turn_id: turnId, turn_index: turnIndex };
}

export function closeConversation(
  db: Database.Database,
  params: { conversation_id: string; summary: string; embedding: Float32Array }
): void {
  const conv = db.prepare('SELECT id, status FROM conversations WHERE id = ?')
    .get(params.conversation_id) as { id: string; status: string } | undefined;

  if (!conv) throw new Error('Conversation not found');
  if (conv.status === 'closed') throw new Error('Conversation already closed');

  const now = Date.now();

  const doClose = db.transaction(() => {
    db.prepare(`
      UPDATE conversations
      SET status = 'closed', summary = ?, updated_at = ?, closed_at = ?
      WHERE id = ?
    `).run(params.summary, now, now, params.conversation_id);

    db.prepare(`
      INSERT INTO conversation_embeddings (id, embedding) VALUES (?, ?)
    `).run(params.conversation_id, params.embedding);
  });

  doClose();
}

export function getConversation(
  db: Database.Database,
  id: string
): { conversation: Conversation; turns: ConversationTurn[] } | null {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Conversation | undefined;
  if (!conv) return null;

  const turns = db.prepare(`
    SELECT * FROM conversation_turns WHERE conversation_id = ? ORDER BY turn_index ASC
  `).all(id) as ConversationTurn[];

  return { conversation: conv, turns };
}

export function queryConversations(
  db: Database.Database,
  params: { embedding: Float32Array; project_id?: string; limit: number }
): ConversationWithScore[] {
  const now = Date.now();

  const candidates = db.prepare(`
    SELECT id, distance
    FROM conversation_embeddings
    WHERE embedding MATCH ?
    AND k = ?
    ORDER BY distance
  `).all(params.embedding, params.limit * 2) as { id: string; distance: number }[];

  if (candidates.length === 0) return [];

  const placeholders = candidates.map(() => '?').join(',');
  let query = `SELECT * FROM conversations WHERE id IN (${placeholders}) AND status = 'closed'`;
  const args: unknown[] = candidates.map(c => c.id);

  if (params.project_id) { query += ' AND project_id = ?'; args.push(params.project_id); }

  const rows = (db.prepare(query).all as (...a: unknown[]) => Conversation[])(...args);
  const distanceMap = new Map(candidates.map(c => [c.id, c.distance]));

  const scored = rows.map(row => {
    const distance = distanceMap.get(row.id) ?? 1;
    const similarity = 1 - (distance * distance) / 2;
    return {
      ...row,
      score: computeScore({
        similarity,
        importance: 0.5,
        lastAccessedAt: row.updated_at,
        now,
      }),
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, params.limit);
}
