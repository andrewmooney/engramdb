# Conversation Memory Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add cross-project conversation memory to mtmem — raw turns stored during a session, compressed into a searchable summary on close.

**Architecture:** Two new tables (`conversations`, `conversation_turns`) plus a `conversation_embeddings` vec0 virtual table in the existing SQLite DB. A new `src/conversation.ts` module mirrors `src/memory.ts`. Five new MCP tools are registered in `src/server.ts`.

**Tech Stack:** TypeScript, better-sqlite3, sqlite-vec (vec0), @huggingface/transformers (embed), @modelcontextprotocol/sdk (McpServer), zod, vitest.

---

## Task 1: Extend the DB schema

**Files:**
- Modify: `src/db.ts`

The `init` transaction in `createDb` already creates the `memories` and `memory_embeddings` tables. We add three new tables to the same transaction.

**Step 1: Add the three conversation tables to the `db.exec` call**

In `src/db.ts`, inside the `db.exec(...)` call inside `init`, append:

```sql
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

CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status  ON conversations(status);

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
```

**Step 2: Verify the DB initialises without error**

```bash
npm run dev -- --help
```

Expected: server starts (or prints usage), no crash.

**Step 3: Commit**

```bash
git add src/db.ts
git commit -m "feat: add conversation tables to DB schema"
```

---

## Task 2: Add conversation types

**Files:**
- Modify: `src/types.ts`

**Step 1: Append the new types**

Add to the bottom of `src/types.ts`:

```ts
export type ConversationStatus = 'open' | 'closed';
export type TurnRole = 'user' | 'assistant' | 'tool';

export interface Conversation {
  id: string;
  project_id: string;
  agent_id: string;
  title: string | null;
  summary: string | null;
  status: ConversationStatus;
  turn_count: number;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
}

export interface ConversationTurn {
  id: string;
  conversation_id: string;
  role: TurnRole;
  content: string;
  turn_index: number;
  created_at: number;
}

export interface ConversationWithScore extends Conversation {
  /** Weighted composite score: 0.6×similarity + 0.25×importance + 0.15×recency. */
  score: number;
}
```

**Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add conversation types"
```

---

## Task 3: Write the conversation module (TDD)

**Files:**
- Create: `src/conversation.ts`
- Create: `src/conversation.test.ts`

This module mirrors `src/memory.ts`. All DB operations go here.

### 3a — Write failing tests first

Create `src/conversation.test.ts`:

```ts
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
```

**Step 2: Run tests to confirm they all fail**

```bash
npm test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|Error" | head -30
```

Expected: all tests fail with "Cannot find module './conversation.js'" or similar.

**Step 3: Create `src/conversation.ts`**

```ts
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
```

**Step 4: Run tests**

```bash
npm test -- --reporter=verbose 2>&1 | tail -30
```

Expected: all conversation tests pass.

**Step 5: Commit**

```bash
git add src/conversation.ts src/conversation.test.ts
git commit -m "feat: conversation CRUD module with tests"
```

---

## Task 4: Implement the 5 tool handlers

**Files:**
- Create: `src/tools/start-conversation.ts`
- Create: `src/tools/append-turn.ts`
- Create: `src/tools/close-conversation.ts`
- Create: `src/tools/get-conversation.ts`
- Create: `src/tools/search-conversations.ts`

### `src/tools/start-conversation.ts`

```ts
import type Database from 'better-sqlite3';
import { insertConversation } from '../conversation.js';

export function handleStartConversation(
  db: Database.Database,
  input: { project_id: string; agent_id: string; title?: string }
) {
  if (!input.project_id?.trim()) throw new Error('project_id is required');
  if (!input.agent_id?.trim()) throw new Error('agent_id is required');
  return insertConversation(db, input);
}
```

### `src/tools/append-turn.ts`

```ts
import type Database from 'better-sqlite3';
import type { TurnRole } from '../types.js';
import { appendTurn } from '../conversation.js';

export function handleAppendTurn(
  db: Database.Database,
  input: { conversation_id: string; role: TurnRole; content: string }
) {
  if (!input.conversation_id?.trim()) throw new Error('conversation_id is required');
  if (!input.content?.trim()) throw new Error('content is required');
  return appendTurn(db, input);
}
```

### `src/tools/close-conversation.ts`

```ts
import type Database from 'better-sqlite3';
import { embed } from '../embeddings.js';
import { closeConversation } from '../conversation.js';

export async function handleCloseConversation(
  db: Database.Database,
  input: { conversation_id: string; summary: string }
) {
  if (!input.conversation_id?.trim()) throw new Error('conversation_id is required');
  if (!input.summary?.trim()) throw new Error('summary is required');

  const embedding = await embed(input.summary).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[mtmem] Embedding failed: ${msg}`);
  });

  closeConversation(db, { ...input, embedding });
  return { message: 'Conversation closed.' };
}
```

### `src/tools/get-conversation.ts`

```ts
import type Database from 'better-sqlite3';
import { getConversation } from '../conversation.js';

export function handleGetConversation(
  db: Database.Database,
  input: { conversation_id: string }
) {
  if (!input.conversation_id?.trim()) throw new Error('conversation_id is required');
  const result = getConversation(db, input.conversation_id);
  if (!result) throw new Error('Conversation not found');
  return result;
}
```

### `src/tools/search-conversations.ts`

```ts
import type Database from 'better-sqlite3';
import { embed } from '../embeddings.js';
import { queryConversations } from '../conversation.js';

export async function handleSearchConversations(
  db: Database.Database,
  input: { query: string; project_id?: string; limit?: number }
) {
  if (!input.query?.trim()) throw new Error('query is required');
  const embedding = await embed(input.query).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[mtmem] Embedding failed: ${msg}`);
  });
  return queryConversations(db, {
    embedding,
    project_id: input.project_id,
    limit: Math.min(input.limit ?? 10, 50),
  });
}
```

**After writing all five files, commit:**

```bash
git add src/tools/start-conversation.ts src/tools/append-turn.ts \
        src/tools/close-conversation.ts src/tools/get-conversation.ts \
        src/tools/search-conversations.ts
git commit -m "feat: conversation tool handlers"
```

---

## Task 5: Register the tools in the MCP server

**Files:**
- Modify: `src/server.ts`

**Step 1: Add imports at the top of `src/server.ts`** (after existing imports):

```ts
import { handleStartConversation } from './tools/start-conversation.js';
import { handleAppendTurn } from './tools/append-turn.js';
import { handleCloseConversation } from './tools/close-conversation.js';
import { handleGetConversation } from './tools/get-conversation.js';
import { handleSearchConversations } from './tools/search-conversations.js';
```

**Step 2: Register the 5 tools** inside `createServer`, before `return server`:

```ts
const TURN_ROLES = ['user', 'assistant', 'tool'] as const;

server.tool(
  'start_conversation',
  'Start a new conversation session for a project',
  {
    project_id: z.string().min(1),
    agent_id: z.string().min(1),
    title: z.string().optional(),
  },
  (input) => {
    try {
      const result = handleStartConversation(db, input);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: msg }], isError: true };
    }
  }
);

server.tool(
  'append_turn',
  'Append a turn to an open conversation',
  {
    conversation_id: z.string().min(1),
    role: z.enum(TURN_ROLES),
    content: z.string().min(1),
  },
  (input) => {
    try {
      const result = handleAppendTurn(db, input);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: msg }], isError: true };
    }
  }
);

server.tool(
  'close_conversation',
  'Close a conversation and store a searchable summary',
  {
    conversation_id: z.string().min(1),
    summary: z.string().min(1),
  },
  async (input) => {
    try {
      const result = await handleCloseConversation(db, input);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: msg }], isError: true };
    }
  }
);

server.tool(
  'get_conversation',
  'Retrieve a conversation and all its turns',
  {
    conversation_id: z.string().min(1),
  },
  (input) => {
    try {
      const result = handleGetConversation(db, input);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: msg }], isError: true };
    }
  }
);

server.tool(
  'search_conversations',
  'Semantically search closed conversations by summary',
  {
    query: z.string().min(1),
    project_id: z.string().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  },
  async (input) => {
    try {
      const results = await handleSearchConversations(db, input);
      return { content: [{ type: 'text', text: JSON.stringify(results) }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: msg }], isError: true };
    }
  }
);
```

**Step 3: Build to check for type errors**

```bash
npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors, `dist/` updated.

**Step 4: Run all tests**

```bash
npm test 2>&1 | tail -20
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add src/server.ts
git commit -m "feat: register 5 conversation MCP tools in server"
```

---

## Task 6: Update README

**Files:**
- Modify: `README.md`

Add a new `## Conversation tools` section after the existing `## Available tools` section. Document all 5 new tools following the same format as the existing tool docs (inputs table, example response).

New tools to document:

**`start_conversation`** — Inputs: `project_id` (req), `agent_id` (req), `title` (opt). Response: `{ "id": "...", "created_at": 1234 }`.

**`append_turn`** — Inputs: `conversation_id` (req), `role` (req, `user|assistant|tool`), `content` (req). Response: `{ "turn_id": "...", "turn_index": 0 }`.

**`close_conversation`** — Inputs: `conversation_id` (req), `summary` (req). Response: `{ "message": "Conversation closed." }`.

**`get_conversation`** — Input: `conversation_id` (req). Response: `{ "conversation": {...}, "turns": [...] }`.

**`search_conversations`** — Inputs: `query` (req), `project_id` (opt), `limit` (opt). Response: array of `{ id, project_id, agent_id, title, summary, score, closed_at, turn_count }`.

**Commit:**

```bash
git add README.md
git commit -m "docs: document conversation memory tools in README"
```

---

## Task 7: Final check

**Step 1: Clean build**

```bash
npm run build 2>&1
```

Expected: no errors.

**Step 2: Full test run**

```bash
npm test 2>&1
```

Expected: all tests pass.
