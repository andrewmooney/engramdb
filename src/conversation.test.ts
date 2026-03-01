import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from './db.js';
import {
  insertConversation,
  appendTurn,
  closeConversation,
  getConversation,
  queryConversations,
} from './conversation.js';
import type Database from 'better-sqlite3';

let db: Database.Database;

beforeEach(() => {
  db = createDb(':memory:');
});

describe('insertConversation', () => {
  it('creates an open conversation and returns id + created_at', () => {
    const result = insertConversation(db, {
      project_id: 'proj-a',
      agent_id: 'agent-1',
      title: 'Test session',
    });
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof result.created_at).toBe('number');

    const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(result.id) as any;
    expect(row.project_id).toBe('proj-a');
    expect(row.agent_id).toBe('agent-1');
    expect(row.title).toBe('Test session');
    expect(row.status).toBe('open');
    expect(row.turn_count).toBe(0);
    expect(row.summary).toBeNull();
    expect(row.closed_at).toBeNull();
  });

  it('allows null title', () => {
    const result = insertConversation(db, { project_id: 'p', agent_id: 'a' });
    const row = db.prepare('SELECT title FROM conversations WHERE id = ?').get(result.id) as any;
    expect(row.title).toBeNull();
  });
});

describe('appendTurn', () => {
  it('inserts a turn and increments turn_count', () => {
    const { id } = insertConversation(db, { project_id: 'p', agent_id: 'a' });
    const turn = appendTurn(db, { conversation_id: id, role: 'user', content: 'Hello' });

    expect(turn.turn_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(turn.turn_index).toBe(0);

    const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as any;
    expect(row.turn_count).toBe(1);
  });

  it('increments turn_index correctly across multiple turns', () => {
    const { id } = insertConversation(db, { project_id: 'p', agent_id: 'a' });
    appendTurn(db, { conversation_id: id, role: 'user', content: 'Hi' });
    const t2 = appendTurn(db, { conversation_id: id, role: 'assistant', content: 'Hello' });
    expect(t2.turn_index).toBe(1);
  });

  it('throws if conversation is closed', () => {
    const { id } = insertConversation(db, { project_id: 'p', agent_id: 'a' });
    closeConversation(db, { conversation_id: id, summary: 'Done', embedding: new Float32Array(768) });
    expect(() =>
      appendTurn(db, { conversation_id: id, role: 'user', content: 'Late msg' })
    ).toThrow('Conversation is closed');
  });

  it('throws if conversation does not exist', () => {
    expect(() =>
      appendTurn(db, { conversation_id: 'not-real', role: 'user', content: 'x' })
    ).toThrow('Conversation not found');
  });
});

describe('closeConversation', () => {
  it('sets status to closed and stores summary + embedding', () => {
    const { id } = insertConversation(db, { project_id: 'p', agent_id: 'a' });
    closeConversation(db, {
      conversation_id: id,
      summary: 'We discussed X.',
      embedding: new Float32Array(768).fill(0.1),
    });

    const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as any;
    expect(row.status).toBe('closed');
    expect(row.summary).toBe('We discussed X.');
    expect(row.closed_at).toBeGreaterThan(0);

    const emb = db.prepare('SELECT id FROM conversation_embeddings WHERE id = ?').get(id);
    expect(emb).toBeTruthy();
  });

  it('throws if conversation is already closed', () => {
    const { id } = insertConversation(db, { project_id: 'p', agent_id: 'a' });
    const emb = new Float32Array(768);
    closeConversation(db, { conversation_id: id, summary: 's', embedding: emb });
    expect(() =>
      closeConversation(db, { conversation_id: id, summary: 's2', embedding: emb })
    ).toThrow('Conversation already closed');
  });

  it('throws if conversation does not exist', () => {
    expect(() =>
      closeConversation(db, {
        conversation_id: 'ghost',
        summary: 's',
        embedding: new Float32Array(768),
      })
    ).toThrow('Conversation not found');
  });
});

describe('getConversation', () => {
  it('returns metadata and turns in order', () => {
    const { id } = insertConversation(db, { project_id: 'p', agent_id: 'a', title: 'Chat' });
    appendTurn(db, { conversation_id: id, role: 'user', content: 'Q1' });
    appendTurn(db, { conversation_id: id, role: 'assistant', content: 'A1' });

    const result = getConversation(db, id);
    expect(result).not.toBeNull();
    expect(result!.conversation.id).toBe(id);
    expect(result!.turns).toHaveLength(2);
    expect(result!.turns[0].content).toBe('Q1');
    expect(result!.turns[1].content).toBe('A1');
  });

  it('returns null for unknown id', () => {
    expect(getConversation(db, 'nope')).toBeNull();
  });
});

describe('queryConversations', () => {
  it('returns closed conversations ranked by similarity', () => {
    const { id } = insertConversation(db, { project_id: 'p', agent_id: 'a' });
    const emb = new Float32Array(768).fill(0.05);
    closeConversation(db, { conversation_id: id, summary: 'Chat about TypeScript', embedding: emb });

    // Query with same embedding — perfect similarity
    const results = queryConversations(db, { embedding: emb, limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe(id);
    expect(typeof results[0].score).toBe('number');
  });

  it('filters by project_id', () => {
    const a = insertConversation(db, { project_id: 'proj-a', agent_id: 'x' });
    const b = insertConversation(db, { project_id: 'proj-b', agent_id: 'x' });
    const emb = new Float32Array(768).fill(0.05);
    closeConversation(db, { conversation_id: a.id, summary: 'A chat', embedding: emb });
    closeConversation(db, { conversation_id: b.id, summary: 'B chat', embedding: emb });

    const results = queryConversations(db, { embedding: emb, project_id: 'proj-a', limit: 10 });
    expect(results.every(r => r.project_id === 'proj-a')).toBe(true);
  });

  it('excludes open conversations', () => {
    const { id } = insertConversation(db, { project_id: 'p', agent_id: 'a' });
    appendTurn(db, { conversation_id: id, role: 'user', content: 'hi' });
    // Not closed → no embedding → should not appear in results

    const emb = new Float32Array(768).fill(0.05);
    const results = queryConversations(db, { embedding: emb, limit: 10 });
    expect(results.find(r => r.id === id)).toBeUndefined();
  });
});
