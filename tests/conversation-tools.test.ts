import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDb } from '../src/db.js';
import type Database from 'better-sqlite3';

vi.mock('../src/embeddings.js', () => ({
  embed: vi.fn().mockResolvedValue(new Float32Array(768).fill(0.1)),
  embedOrThrow: vi.fn().mockResolvedValue(new Float32Array(768).fill(0.1)),
}));

let db: Database.Database;

beforeEach(() => {
  db = createDb(':memory:');
});

describe('start_conversation tool', () => {
  it('creates an open conversation and returns id', async () => {
    const { handleStartConversation } = await import('../src/tools/start-conversation.js');
    const result = handleStartConversation(db, {
      project_id: 'my-project',
      agent_id: 'opencode',
      title: 'Test session',
    });
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.created_at).toBeGreaterThan(0);

    // Verify conversation is actually open in DB
    const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(result.id) as any;
    expect(row.status).toBe('open');
    expect(row.project_id).toBe('my-project');
    expect(row.agent_id).toBe('opencode');
    expect(row.title).toBe('Test session');
    expect(row.turn_count).toBe(0);
  });

  it('throws for empty project_id', async () => {
    const { handleStartConversation } = await import('../src/tools/start-conversation.js');
    expect(() =>
      handleStartConversation(db, { project_id: '', agent_id: 'opencode' })
    ).toThrow('project_id is required');
  });

  it('throws for empty agent_id', async () => {
    const { handleStartConversation } = await import('../src/tools/start-conversation.js');
    expect(() =>
      handleStartConversation(db, { project_id: 'proj', agent_id: '' })
    ).toThrow('agent_id is required');
  });

  it('allows optional title to be omitted', async () => {
    const { handleStartConversation } = await import('../src/tools/start-conversation.js');
    const result = handleStartConversation(db, { project_id: 'p', agent_id: 'a' });
    const row = db.prepare('SELECT title FROM conversations WHERE id = ?').get(result.id) as any;
    expect(row.title).toBeNull();
  });
});

describe('append_turn tool', () => {
  it('appends a user turn and increments turn_count', async () => {
    const { handleStartConversation } = await import('../src/tools/start-conversation.js');
    const { handleAppendTurn } = await import('../src/tools/append-turn.js');

    const { id } = handleStartConversation(db, { project_id: 'p', agent_id: 'a' });
    const result = handleAppendTurn(db, {
      conversation_id: id,
      role: 'user',
      content: 'What is TypeScript?',
    });

    expect(result.turn_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.turn_index).toBe(0);

    const row = db.prepare('SELECT turn_count FROM conversations WHERE id = ?').get(id) as any;
    expect(row.turn_count).toBe(1);
  });

  it('appends an assistant turn after a user turn', async () => {
    const { handleStartConversation } = await import('../src/tools/start-conversation.js');
    const { handleAppendTurn } = await import('../src/tools/append-turn.js');

    const { id } = handleStartConversation(db, { project_id: 'p', agent_id: 'a' });
    handleAppendTurn(db, { conversation_id: id, role: 'user', content: 'Question' });
    const t2 = handleAppendTurn(db, { conversation_id: id, role: 'assistant', content: 'Answer' });

    expect(t2.turn_index).toBe(1);
    const row = db.prepare('SELECT turn_count FROM conversations WHERE id = ?').get(id) as any;
    expect(row.turn_count).toBe(2);
  });

  it('throws for empty conversation_id', async () => {
    const { handleAppendTurn } = await import('../src/tools/append-turn.js');
    expect(() =>
      handleAppendTurn(db, { conversation_id: '', role: 'user', content: 'Hi' })
    ).toThrow('conversation_id is required');
  });

  it('throws for empty content', async () => {
    const { handleStartConversation } = await import('../src/tools/start-conversation.js');
    const { handleAppendTurn } = await import('../src/tools/append-turn.js');
    const { id } = handleStartConversation(db, { project_id: 'p', agent_id: 'a' });
    expect(() =>
      handleAppendTurn(db, { conversation_id: id, role: 'user', content: '' })
    ).toThrow('content is required');
  });
});

describe('close_conversation tool', () => {
  it('closes a conversation and stores a summary', async () => {
    const { handleStartConversation } = await import('../src/tools/start-conversation.js');
    const { handleAppendTurn } = await import('../src/tools/append-turn.js');
    const { handleCloseConversation } = await import('../src/tools/close-conversation.js');

    const { id } = handleStartConversation(db, { project_id: 'p', agent_id: 'a', title: 'My session' });
    handleAppendTurn(db, { conversation_id: id, role: 'user', content: 'Hello' });
    handleAppendTurn(db, { conversation_id: id, role: 'assistant', content: 'Hi there!' });

    const result = await handleCloseConversation(db, {
      conversation_id: id,
      summary: 'We discussed greetings.',
    });
    expect(result).toEqual({ message: 'Conversation closed.' });

    const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as any;
    expect(row.status).toBe('closed');
    expect(row.summary).toBe('We discussed greetings.');
    expect(row.closed_at).toBeGreaterThan(0);

    const emb = db.prepare('SELECT id FROM conversation_embeddings WHERE id = ?').get(id);
    expect(emb).toBeTruthy();
  });

  it('throws for empty conversation_id', async () => {
    const { handleCloseConversation } = await import('../src/tools/close-conversation.js');
    await expect(
      handleCloseConversation(db, { conversation_id: '', summary: 'Done' })
    ).rejects.toThrow('conversation_id is required');
  });

  it('throws for empty summary', async () => {
    const { handleStartConversation } = await import('../src/tools/start-conversation.js');
    const { handleCloseConversation } = await import('../src/tools/close-conversation.js');
    const { id } = handleStartConversation(db, { project_id: 'p', agent_id: 'a' });
    await expect(
      handleCloseConversation(db, { conversation_id: id, summary: '' })
    ).rejects.toThrow('summary is required');
  });
});

describe('get_conversation tool', () => {
  it('retrieves a conversation with all its turns', async () => {
    const { handleStartConversation } = await import('../src/tools/start-conversation.js');
    const { handleAppendTurn } = await import('../src/tools/append-turn.js');
    const { handleGetConversation } = await import('../src/tools/get-conversation.js');

    const { id } = handleStartConversation(db, { project_id: 'p', agent_id: 'a', title: 'Chat' });
    handleAppendTurn(db, { conversation_id: id, role: 'user', content: 'Q1' });
    handleAppendTurn(db, { conversation_id: id, role: 'assistant', content: 'A1' });

    const result = handleGetConversation(db, { conversation_id: id });
    expect(result.conversation.id).toBe(id);
    expect(result.conversation.title).toBe('Chat');
    expect(result.turns).toHaveLength(2);
    expect(result.turns[0].role).toBe('user');
    expect(result.turns[0].content).toBe('Q1');
    expect(result.turns[1].role).toBe('assistant');
    expect(result.turns[1].content).toBe('A1');
  });

  it('throws for unknown conversation_id', async () => {
    const { handleGetConversation } = await import('../src/tools/get-conversation.js');
    expect(() =>
      handleGetConversation(db, { conversation_id: 'does-not-exist' })
    ).toThrow('Conversation not found');
  });

  it('throws for empty conversation_id', async () => {
    const { handleGetConversation } = await import('../src/tools/get-conversation.js');
    expect(() =>
      handleGetConversation(db, { conversation_id: '' })
    ).toThrow('conversation_id is required');
  });
});

describe('search_conversations tool', () => {
  it('returns closed conversations ranked by similarity', async () => {
    const { handleStartConversation } = await import('../src/tools/start-conversation.js');
    const { handleCloseConversation } = await import('../src/tools/close-conversation.js');
    const { handleSearchConversations } = await import('../src/tools/search-conversations.js');

    const { id } = handleStartConversation(db, { project_id: 'p', agent_id: 'a' });
    await handleCloseConversation(db, { conversation_id: id, summary: 'We discussed TypeScript generics.' });

    const results = await handleSearchConversations(db, { query: 'TypeScript generics', project_id: 'p' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe(id);
    expect(typeof results[0].score).toBe('number');
  });

  it('does not return open conversations', async () => {
    const { handleStartConversation } = await import('../src/tools/start-conversation.js');
    const { handleSearchConversations } = await import('../src/tools/search-conversations.js');

    const { id } = handleStartConversation(db, { project_id: 'p', agent_id: 'a' });
    // Never closed — should not appear

    const results = await handleSearchConversations(db, { query: 'anything' });
    expect(results.find(r => r.id === id)).toBeUndefined();
  });

  it('throws for empty query', async () => {
    const { handleSearchConversations } = await import('../src/tools/search-conversations.js');
    await expect(handleSearchConversations(db, { query: '' })).rejects.toThrow('query is required');
  });
});

describe('full conversation lifecycle', () => {
  it('start → append multiple turns → close → retrieve → search', async () => {
    const { handleStartConversation } = await import('../src/tools/start-conversation.js');
    const { handleAppendTurn } = await import('../src/tools/append-turn.js');
    const { handleCloseConversation } = await import('../src/tools/close-conversation.js');
    const { handleGetConversation } = await import('../src/tools/get-conversation.js');
    const { handleSearchConversations } = await import('../src/tools/search-conversations.js');

    // 1. Start a conversation (simulates session.created)
    const { id } = handleStartConversation(db, {
      project_id: 'engramdb',
      agent_id: 'opencode',
      title: 'OpenCode session 2026-01-01T00:00:00.000Z',
    });
    expect(id).toBeTruthy();

    // 2. Append turns as they happen (simulates session.idle auto-appending)
    handleAppendTurn(db, { conversation_id: id, role: 'user', content: 'How do I add indexes to the DB?' });
    handleAppendTurn(db, { conversation_id: id, role: 'assistant', content: 'You can add an index using CREATE INDEX ...' });
    handleAppendTurn(db, { conversation_id: id, role: 'user', content: 'Thanks!' });
    handleAppendTurn(db, { conversation_id: id, role: 'assistant', content: 'Happy to help.' });

    // Verify turn count before closing
    const before = db.prepare('SELECT turn_count, status FROM conversations WHERE id = ?').get(id) as any;
    expect(before.status).toBe('open');
    expect(before.turn_count).toBe(4);

    // 3. Close with summary (simulates session.deleted)
    await handleCloseConversation(db, {
      conversation_id: id,
      summary: 'user: How do I add indexes to the DB?\nassistant: You can add an index using CREATE INDEX ...',
    });

    // 4. Verify it is closed and persisted
    const after = db.prepare('SELECT status, summary, closed_at FROM conversations WHERE id = ?').get(id) as any;
    expect(after.status).toBe('closed');
    expect(after.summary).toContain('CREATE INDEX');
    expect(after.closed_at).toBeGreaterThan(0);

    // 5. Retrieve and verify full turn history is preserved
    const retrieved = handleGetConversation(db, { conversation_id: id });
    expect(retrieved.conversation.status).toBe('closed');
    expect(retrieved.turns).toHaveLength(4);
    expect(retrieved.turns[0].role).toBe('user');
    expect(retrieved.turns[3].content).toBe('Happy to help.');

    // 6. Semantic search finds the saved conversation
    const searchResults = await handleSearchConversations(db, {
      query: 'database indexes SQLite',
      project_id: 'engramdb',
    });
    expect(searchResults.length).toBeGreaterThan(0);
    expect(searchResults[0].id).toBe(id);
  });
});
