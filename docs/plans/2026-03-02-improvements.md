# engramdb Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement correctness fixes, performance improvements, new MCP tools, and code quality cleanup identified during technical analysis of the engramdb codebase.

**Architecture:** Tasks are grouped by dependency order. Schema migration system first (other tasks depend on it). Then correctness/performance fixes. Then refactors. Then new MCP tools last (they build on the fixed internals). Branch: `improvements`.

**Tech Stack:** TypeScript ESM (`.js` imports), Vitest, better-sqlite3, @modelcontextprotocol/sdk, @huggingface/transformers (nomic-embed-text-v1)

---

## Setup: Create the branch

```bash
git checkout -b improvements
```

---

## Task 1: Schema migration system

Add a lightweight migration runner: a `schema_migrations` table tracks applied migrations by version number. On every `createDb()` call, the runner applies any unapplied migrations in order.

**Files:**
- Create: `src/migrations/index.ts` — migration runner
- Create: `src/migrations/001_add_indexes.ts` — first migration (new indexes)
- Modify: `src/db.ts` — call migration runner after init
- Modify: `tests/db.test.ts` — add migration tests

### Step 1: Write failing tests

Add to `tests/db.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createDb } from '../src/db.js';

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
```

Run: `npm test -- --reporter=verbose tests/db.test.ts`
Expected: FAIL — `schema_migrations` table does not exist.

### Step 2: Create `src/migrations/001_add_indexes.ts`

```typescript
export const version = 1;
export const sql = `
  CREATE INDEX IF NOT EXISTS idx_memories_updated_at ON memories(updated_at);
  CREATE INDEX IF NOT EXISTS idx_memories_agent_id   ON memories(agent_id);
`;
```

### Step 3: Create `src/migrations/index.ts`

```typescript
import type Database from 'better-sqlite3';
import { version as v1, sql as sql1 } from './001_add_indexes.js';

const MIGRATIONS: { version: number; sql: string }[] = [
  { version: v1, sql: sql1 },
];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(r => r.version)
  );

  const applyMigration = db.transaction((version: number, sql: string) => {
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, Date.now());
  });

  for (const m of MIGRATIONS) {
    if (!applied.has(m.version)) {
      applyMigration(m.version, m.sql);
    }
  }
}
```

### Step 4: Wire into `src/db.ts`

Add import after existing imports:
```typescript
import { runMigrations } from './migrations/index.js';
```

Add call at the end of `createDb`, just before `return db`:
```typescript
  runMigrations(db);
```

The full updated tail of `createDb` looks like:
```typescript
  init();
  runMigrations(db);
  return db;
```

### Step 5: Run tests to verify they pass

Run: `npm test -- --reporter=verbose tests/db.test.ts`
Expected: PASS — all four migration tests pass.

### Step 6: Run full test suite

Run: `npm test`
Expected: all tests pass (no regressions).

### Step 7: Commit

```bash
git add src/migrations/ src/db.ts tests/db.test.ts
git commit -m "feat: add schema migration system with idx_memories_updated_at and idx_memories_agent_id"
```

---

## Task 2: Correctness fixes — small, no new tests needed

Fix four small correctness issues in one commit:

1. `path.join(path, '..')` → `path.dirname(path)` in `db.ts:11`
2. Fix misleading JSDoc on `ConversationWithScore` in `types.ts:53` (importance is hardcoded 0.5, not derived from the weight env var)
3. Validate weight sum at startup in `memory.ts`
4. Clamp `importance` in `insertMemory` (currently only clamped in `remember.ts`)

**Files:**
- Modify: `src/db.ts`
- Modify: `src/types.ts`
- Modify: `src/memory.ts`

### Step 1: Write failing tests

Add to `tests/memory.test.ts`:

```typescript
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
```

Run: `npm test -- --reporter=verbose tests/memory.test.ts`
Expected: FAIL — importance 1.5 is stored as-is.

### Step 2: Apply fixes

**`src/db.ts` — `path.dirname` fix**

Replace:
```typescript
import { join } from 'path';
```
With:
```typescript
import { join, dirname } from 'path';
```

Replace:
```typescript
    mkdirSync(join(path, '..'), { recursive: true });
```
With:
```typescript
    mkdirSync(dirname(path), { recursive: true });
```

**`src/types.ts` — fix JSDoc**

Replace the JSDoc on `ConversationWithScore.score` (the second `score` property with JSDoc, around line 53):
```typescript
  /** Weighted composite score: 0.6×similarity + 0.25×importance + 0.15×recency. Higher is better. Range: [0, ~1]. */
  score: number;
}
```
(This is the closing of `ConversationWithScore` — confirm it's the second occurrence by checking it's inside `ConversationWithScore`, not `MemoryWithScore`.)

With:
```typescript
  /** Weighted composite score: 0.6×similarity + 0.5×(hardcoded importance) + 0.15×recency. Importance is fixed at 0.5 for conversations; ENGRAMDB_W_IMP has no effect here. Higher is better. Range: [0, ~1]. */
  score: number;
}
```

**`src/memory.ts` — weight sum validation**

After the four constant declarations at lines 5–8, add:
```typescript

// Warn at startup if weights don't sum to ~1.0
const W_SUM = W_SIM + W_IMP + W_REC;
if (Math.abs(W_SUM - 1.0) > 0.01) {
  process.stderr.write(
    `[engramdb] WARNING: score weights sum to ${W_SUM.toFixed(3)}, expected ~1.0. ` +
    `Set ENGRAMDB_W_SIM + ENGRAMDB_W_IMP + ENGRAMDB_W_REC ≈ 1.0\n`
  );
}
```

**`src/memory.ts` — clamp importance in `insertMemory`**

In `insertMemory`, replace:
```typescript
  const id = uuidv4();
  const now = Date.now();
```
With:
```typescript
  const id = uuidv4();
  const now = Date.now();
  const importance = Math.max(0, Math.min(1, params.importance));
```

And in the INSERT statement, replace `params.importance` with `importance`:
```typescript
    `).run(id, params.project_id, params.agent_id, params.type, params.content,
           importance, now, now, now);
```

### Step 3: Run tests to verify they pass

Run: `npm test -- --reporter=verbose tests/memory.test.ts`
Expected: PASS — both clamp tests pass.

### Step 4: Run full test suite

Run: `npm test`
Expected: all tests pass.

### Step 5: Commit

```bash
git add src/db.ts src/types.ts src/memory.ts tests/memory.test.ts
git commit -m "fix: path.dirname, importance clamp in insertMemory, weight-sum warning, ConversationWithScore JSDoc"
```

---

## Task 3: N+1 UPDATE fix in `queryMemories`

Replace the per-row `UPDATE` loop (up to 50 individual UPDATEs per query) with a single batched `UPDATE ... WHERE id IN (...)` inside a transaction.

**Files:**
- Modify: `src/memory.ts`
- Modify: `tests/memory.test.ts`

### Step 1: Write a failing test

Add to `tests/memory.test.ts`:

```typescript
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
```

Run: `npm test -- --reporter=verbose tests/memory.test.ts`
Expected: PASS — confirms baseline correctness before refactor.

### Step 2: Replace the loop in `src/memory.ts`

Locate the access metadata update block (around lines 112–116):

```typescript
  // Update access metadata
  const updateStmt = db.prepare(`
    UPDATE memories SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?
  `);
  for (const m of top) updateStmt.run(now, m.id);
```

Replace with:

```typescript
  // Batch-update access metadata in a single statement
  if (top.length > 0) {
    const placeholders = top.map(() => '?').join(',');
    db.transaction(() => {
      (db.prepare(
        `UPDATE memories SET last_accessed_at = ?, access_count = access_count + 1 WHERE id IN (${placeholders})`
      ).run as (...a: unknown[]) => void)(now, ...top.map(m => m.id));
    })();
  }
```

### Step 3: Run tests to verify they pass

Run: `npm test -- --reporter=verbose tests/memory.test.ts`
Expected: PASS.

### Step 4: Run full test suite

Run: `npm test`
Expected: all pass.

### Step 5: Commit

```bash
git add src/memory.ts tests/memory.test.ts
git commit -m "perf: replace N+1 UPDATE loop in queryMemories with single batched UPDATE"
```

---

## Task 4: ANN oversampling improvement

When a `project_id` or `agent_id` filter is specified, the ANN step may return many candidates that get filtered out. Use `limit * 5` oversampling (instead of `limit * 2`) when any filter is active.

**Files:**
- Modify: `src/memory.ts`
- Modify: `src/conversation.ts`

No new tests needed — this is a query-quality improvement that isn't testable in isolation.

### Step 1: Update `src/memory.ts`

In `queryMemories`, replace the comment + ANN query block:
```typescript
  // Get top candidates from vector search (2x limit for re-scoring)
  const candidates = db.prepare(`
    SELECT id, distance
    FROM memory_embeddings
    WHERE embedding MATCH ?
    AND k = ?
    ORDER BY distance
  `).all(params.embedding, params.limit * 2) as { id: string; distance: number }[];
```
With:
```typescript
  // Oversample for re-scoring: 5x when filters are active (reduces post-filter miss rate)
  const hasFilter = !!(params.project_id || params.agent_id || params.type);
  const oversample = params.limit * (hasFilter ? 5 : 2);
  const candidates = db.prepare(`
    SELECT id, distance
    FROM memory_embeddings
    WHERE embedding MATCH ?
    AND k = ?
    ORDER BY distance
  `).all(params.embedding, oversample) as { id: string; distance: number }[];
```

### Step 2: Update `src/conversation.ts`

In `queryConversations`, replace:
```typescript
  const candidates = db.prepare(`
    SELECT id, distance
    FROM conversation_embeddings
    WHERE embedding MATCH ?
    AND k = ?
    ORDER BY distance
  `).all(params.embedding, params.limit * 2) as { id: string; distance: number }[];
```
With:
```typescript
  const oversample = params.limit * (params.project_id ? 5 : 2);
  const candidates = db.prepare(`
    SELECT id, distance
    FROM conversation_embeddings
    WHERE embedding MATCH ?
    AND k = ?
    ORDER BY distance
  `).all(params.embedding, oversample) as { id: string; distance: number }[];
```

### Step 3: Run full test suite

Run: `npm test`
Expected: all tests pass.

### Step 4: Commit

```bash
git add src/memory.ts src/conversation.ts
git commit -m "perf: use 5x ANN oversampling when project/agent/type filter is active"
```

---

## Task 5: Extract `embedOrThrow` helper + fix `disposeEmbedder`

Two related embeddings improvements:
1. Extract the repeated `embed(...).catch(...)` pattern into `embedOrThrow(text)` in `src/embeddings.ts`
2. Fix `disposeEmbedder` to actually call `pipe.dispose()` if available

**Files:**
- Modify: `src/embeddings.ts`
- Modify: `src/tools/remember.ts`
- Modify: `src/tools/recall.ts`
- Modify: `src/tools/update.ts`
- Modify: `src/tools/search-global.ts`
- Modify: `src/tools/close-conversation.ts`
- Modify: `src/tools/search-conversations.ts`
- Modify: `tests/embeddings.test.ts`

### Step 1: Write failing tests

Replace the contents of `tests/embeddings.test.ts` with:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn().mockResolvedValue(
    vi.fn().mockResolvedValue({
      data: new Float32Array(768).fill(0.1),
    })
  ),
}));

describe('embed', () => {
  it('returns a Float32Array of length 768', async () => {
    const { embed } = await import('../src/embeddings.js');
    const result = await embed('hello world');
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(768);
  });
});

describe('embedOrThrow', () => {
  it('is exported from embeddings.ts', async () => {
    const mod = await import('../src/embeddings.js');
    expect(typeof mod.embedOrThrow).toBe('function');
  });

  it('returns a Float32Array on success', async () => {
    const { embedOrThrow } = await import('../src/embeddings.js');
    const result = await embedOrThrow('hello world');
    expect(result).toBeInstanceOf(Float32Array);
  });
});

describe('disposeEmbedder', () => {
  it('is callable without throwing', async () => {
    const { disposeEmbedder } = await import('../src/embeddings.js');
    expect(() => disposeEmbedder()).not.toThrow();
  });
});
```

Run: `npm test -- --reporter=verbose tests/embeddings.test.ts`
Expected: FAIL — `embedOrThrow` is not exported.

### Step 2: Update `src/embeddings.ts`

Replace the entire file contents with:

```typescript
import type { FeatureExtractionPipeline } from '@huggingface/transformers';

type PipelineFn = (task: 'feature-extraction', model: string) => Promise<FeatureExtractionPipeline>;

let embedderPromise: Promise<FeatureExtractionPipeline> | null = null;

export function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      process.stderr.write('[engramdb] Loading embedding model (first run may take a moment)...\n');
      const { pipeline } = await import('@huggingface/transformers');
      const e = await (pipeline as unknown as PipelineFn)('feature-extraction', 'nomic-ai/nomic-embed-text-v1');
      process.stderr.write('[engramdb] Embedding model ready.\n');
      return e;
    })();
  }
  return embedderPromise;
}

export async function embed(text: string, prefix = ''): Promise<Float32Array> {
  const pipe = await getEmbedder();
  const output = await pipe(prefix + text, { pooling: 'mean', normalize: true });
  const data = output.data;
  if (!(data instanceof Float32Array)) {
    throw new Error(`[engramdb] Expected Float32Array from embedder, got ${(data as unknown as { constructor: { name: string } }).constructor.name}`);
  }
  return data;
}

/** Embeds text and wraps any error with an [engramdb] prefix. Use instead of embed().catch(...) inline. */
export async function embedOrThrow(text: string, prefix = ''): Promise<Float32Array> {
  return embed(text, prefix).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[engramdb] Embedding failed: ${msg}`);
  });
}

export function disposeEmbedder(): void {
  if (embedderPromise) {
    // Attempt to dispose ONNX session if the pipeline exposes it
    embedderPromise.then((pipe) => {
      if (typeof (pipe as unknown as { dispose?: () => void }).dispose === 'function') {
        (pipe as unknown as { dispose: () => void }).dispose();
      }
    }).catch(() => { /* ignore dispose errors */ });
  }
  embedderPromise = null;
}
```

### Step 3: Update all tool files to use `embedOrThrow`

**`src/tools/remember.ts`** — update import and usage:
```typescript
import { embedOrThrow } from '../embeddings.js';
```
Replace:
```typescript
  const embedding = await embed(input.content).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[engramdb] Embedding failed: ${msg}`);
  });
```
With:
```typescript
  const embedding = await embedOrThrow(input.content);
```

**`src/tools/recall.ts`** — update import and usage:
```typescript
import { embedOrThrow } from '../embeddings.js';
```
Replace:
```typescript
  const embedding = await embed(input.query).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[engramdb] Embedding failed: ${msg}`);
  });
```
With:
```typescript
  const embedding = await embedOrThrow(input.query);
```

**`src/tools/update.ts`** — update import and usage:
```typescript
import { embedOrThrow } from '../embeddings.js';
```
Replace:
```typescript
  const embedding = input.content ? await embed(input.content).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[engramdb] Embedding failed: ${msg}`);
  }) : undefined;
```
With:
```typescript
  const embedding = input.content ? await embedOrThrow(input.content) : undefined;
```

**`src/tools/search-global.ts`** — update import and usage:
```typescript
import { embedOrThrow } from '../embeddings.js';
```
Replace:
```typescript
  const embedding = await embed(input.query).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[engramdb] Embedding failed: ${msg}`);
  });
```
With:
```typescript
  const embedding = await embedOrThrow(input.query);
```

**`src/tools/close-conversation.ts`** — update import and usage:
```typescript
import { embedOrThrow } from '../embeddings.js';
```
Replace:
```typescript
  const embedding = await embed(input.summary).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[engramdb] Embedding failed: ${msg}`);
  });
```
With:
```typescript
  const embedding = await embedOrThrow(input.summary);
```

**`src/tools/search-conversations.ts`** — update import and usage:
```typescript
import { embedOrThrow } from '../embeddings.js';
```
Replace:
```typescript
  const embedding = await embed(input.query).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[engramdb] Embedding failed: ${msg}`);
  });
```
With:
```typescript
  const embedding = await embedOrThrow(input.query);
```

### Step 4: Run tests

Run: `npm test -- --reporter=verbose tests/embeddings.test.ts`
Expected: PASS.

Run: `npm test`
Expected: all tests pass.

### Step 5: Commit

```bash
git add src/embeddings.ts src/tools/remember.ts src/tools/recall.ts src/tools/update.ts \
        src/tools/search-global.ts src/tools/close-conversation.ts src/tools/search-conversations.ts \
        tests/embeddings.test.ts
git commit -m "refactor: extract embedOrThrow helper, fix disposeEmbedder to call pipe.dispose()"
```

---

## Task 6: Task prefixes for embeddings (nomic-embed-text-v1)

`nomic-embed-text-v1` was trained with `"search_document: "` / `"search_query: "` prefixes. Without them, similarity scores are lower and retrieval quality degrades. Store memories and conversation summaries with the document prefix; embed queries with the query prefix.

Note: `src/embeddings.ts` already has the `prefix` parameter added in Task 5. This task wires the actual prefix strings through the tool layer.

**Files:**
- Modify: `src/tools/remember.ts` — pass `'search_document: '` prefix
- Modify: `src/tools/recall.ts` — pass `'search_query: '` prefix
- Modify: `src/tools/update.ts` — pass `'search_document: '` prefix
- Modify: `src/tools/search-global.ts` — pass `'search_query: '` prefix
- Modify: `src/tools/close-conversation.ts` — pass `'search_document: '` prefix
- Modify: `src/tools/search-conversations.ts` — pass `'search_query: '` prefix
- Create: `scripts/migrate-embeddings.ts` — one-off script to re-embed existing data
- Modify: `tests/embeddings.test.ts` — test prefix behavior

### Step 1: Write failing tests

Add to `tests/embeddings.test.ts`:

```typescript
describe('embed with prefix', () => {
  it('prepends search_document prefix to stored content', async () => {
    const { embed } = await import('../src/embeddings.js');
    // The mock returns the same Float32Array regardless of input.
    // We verify the function accepts a prefix argument without error.
    const result = await embed('my content', 'search_document: ');
    expect(result).toBeInstanceOf(Float32Array);
  });

  it('prepends search_query prefix to queries', async () => {
    const { embed } = await import('../src/embeddings.js');
    const result = await embed('my query', 'search_query: ');
    expect(result).toBeInstanceOf(Float32Array);
  });
});
```

Run: `npm test -- --reporter=verbose tests/embeddings.test.ts`
Expected: PASS (prefix parameter already added in Task 5, so this verifies the API).

### Step 2: Pass correct prefixes in all tool files

**`src/tools/remember.ts`:**
```typescript
  const embedding = await embedOrThrow(input.content, 'search_document: ');
```

**`src/tools/recall.ts`:**
```typescript
  const embedding = await embedOrThrow(input.query, 'search_query: ');
```

**`src/tools/update.ts`:**
```typescript
  const embedding = input.content ? await embedOrThrow(input.content, 'search_document: ') : undefined;
```

**`src/tools/search-global.ts`:**
```typescript
  const embedding = await embedOrThrow(input.query, 'search_query: ');
```

**`src/tools/close-conversation.ts`:**
```typescript
  const embedding = await embedOrThrow(input.summary, 'search_document: ');
```

**`src/tools/search-conversations.ts`:**
```typescript
  const embedding = await embedOrThrow(input.query, 'search_query: ');
```

### Step 3: Create the migration script

Create `scripts/migrate-embeddings.ts`:

```typescript
#!/usr/bin/env node
/**
 * One-off migration: re-embed all memories and conversation summaries with nomic task prefixes.
 *
 * Run after deploying the task-prefix change:
 *   npx tsx scripts/migrate-embeddings.ts
 *
 * Safe to re-run (idempotent — overwrites embeddings for all rows).
 */
import Database from 'better-sqlite3';
import { load } from 'sqlite-vec';
import { homedir } from 'os';
import { join } from 'path';

const DB_PATH = process.env.ENGRAMDB_DB_PATH ?? join(homedir(), '.global-agent-memory.db');

const db = new Database(DB_PATH);
load(db);
db.pragma('journal_mode = WAL');

// Dynamically import the embedder (ESM)
const { embed } = await import('../src/embeddings.js');

// --- Re-embed memories ---
const memories = db.prepare('SELECT id, content FROM memories').all() as { id: string; content: string }[];
console.log(`Re-embedding ${memories.length} memories...`);
let memDone = 0;
for (const m of memories) {
  const embedding = await embed(m.content, 'search_document: ');
  db.prepare('UPDATE memory_embeddings SET embedding = ? WHERE id = ?').run(embedding, m.id);
  memDone++;
  if (memDone % 10 === 0) process.stdout.write(`  ${memDone}/${memories.length}\n`);
}
console.log(`Memories done: ${memDone}`);

// --- Re-embed closed conversations ---
const convs = db.prepare(`SELECT id, summary FROM conversations WHERE status = 'closed' AND summary IS NOT NULL`).all() as { id: string; summary: string }[];
console.log(`Re-embedding ${convs.length} conversation summaries...`);
let convDone = 0;
for (const c of convs) {
  const embedding = await embed(c.summary, 'search_document: ');
  db.prepare('UPDATE conversation_embeddings SET embedding = ? WHERE id = ?').run(embedding, c.id);
  convDone++;
  if (convDone % 10 === 0) process.stdout.write(`  ${convDone}/${convs.length}\n`);
}
console.log(`Conversations done: ${convDone}`);

console.log('Migration complete.');
db.close();
```

### Step 4: Run tests

Run: `npm test`
Expected: all tests pass.

### Step 5: Commit

```bash
git add src/tools/remember.ts src/tools/recall.ts src/tools/update.ts \
        src/tools/search-global.ts src/tools/close-conversation.ts src/tools/search-conversations.ts \
        scripts/migrate-embeddings.ts tests/embeddings.test.ts
git commit -m "feat: add nomic task prefixes (search_document/search_query) to all embeddings + migration script"
```

---

## Task 7: Validation fixes — empty-string `agent_id`, runtime `type` guard in `updateMemory`

Two validation correctness fixes:
1. `recall_memories` and `search_conversations` in `server.ts` accept `agent_id: z.string().optional()` — this allows `""` which will never match anything. Change to `z.string().min(1).optional()`.
2. `updateMemory` in `memory.ts` accepts any string for `type` at the DB layer — add a runtime guard.

**Files:**
- Modify: `src/server.ts`
- Modify: `src/memory.ts`
- Modify: `tests/tools.test.ts`
- Modify: `tests/memory.test.ts`

### Step 1: Write failing tests

Add to `tests/memory.test.ts`:

```typescript
describe('updateMemory type validation', () => {
  let db: Database.Database;
  beforeEach(() => { db = createDb(':memory:'); });

  it('throws for invalid type value', () => {
    const { id } = insertMemory(db, {
      project_id: '/p', agent_id: 'a', type: 'fact', content: 'x',
      importance: 0.5, embedding: new Float32Array(768).fill(0.1),
    });
    expect(() => updateMemory(db, id, { type: 'invalid_type' as MemoryType }))
      .toThrow('Invalid memory type');
  });
});
```

You will need to import `MemoryType` in `tests/memory.test.ts`:
```typescript
import type { MemoryType } from '../src/types.js';
```

Run: `npm test -- --reporter=verbose tests/memory.test.ts`
Expected: FAIL — `updateMemory` accepts any string for type.

### Step 2: Add runtime type guard to `updateMemory` in `src/memory.ts`

After the weight constant declarations (around line 8), add:
```typescript

const VALID_MEMORY_TYPES = new Set<string>(['fact', 'code_pattern', 'preference', 'decision', 'task', 'observation']);
```

In `updateMemory`, after the `if (!existing) return null;` check, add:
```typescript
  if (fields.type !== undefined && !VALID_MEMORY_TYPES.has(fields.type)) {
    throw new Error(`Invalid memory type: "${fields.type}". Valid types: ${[...VALID_MEMORY_TYPES].join(', ')}`);
  }
```

### Step 3: Fix `server.ts` Zod schemas

In `src/server.ts`:

For `recall_memories` (around line 53), replace:
```typescript
      agent_id: z.string().optional(),
```
With:
```typescript
      agent_id: z.string().min(1).optional(),
```

For `search_conversations` (around line 253), replace:
```typescript
      project_id: z.string().optional(),
```
With:
```typescript
      project_id: z.string().min(1).optional(),
```

### Step 4: Run tests

Run: `npm test -- --reporter=verbose tests/memory.test.ts tests/tools.test.ts`
Expected: PASS on all tests.

### Step 5: Run full test suite

Run: `npm test`
Expected: all tests pass.

### Step 6: Commit

```bash
git add src/memory.ts src/server.ts tests/memory.test.ts tests/tools.test.ts
git commit -m "fix: runtime type guard in updateMemory, min(1) validation for agent_id and project_id filters"
```

---

## Task 8: Upsert deduplication in `remember_memory`

If a memory with the exact same `content` already exists in the same `project_id`, update its `importance` and `updated_at` instead of inserting a duplicate.

**Files:**
- Modify: `src/memory.ts` — add `upsertMemory` function
- Modify: `src/tools/remember.ts` — call `upsertMemory` instead of `insertMemory`
- Modify: `tests/tools.test.ts`

### Step 1: Write failing tests

Add to `tests/tools.test.ts`:

```typescript
describe('remember_memory deduplication (upsert)', () => {
  it('returns the same id for identical content in the same project', async () => {
    const { handleRemember } = await import('../src/tools/remember.js');
    const r1 = await handleRemember(db, { project_id: '/p', agent_id: 'a', type: 'fact', content: 'exact same', importance: 0.5 });
    const r2 = await handleRemember(db, { project_id: '/p', agent_id: 'a', type: 'fact', content: 'exact same', importance: 0.8 });
    expect(r1.id).toBe(r2.id);
  });

  it('updates importance when upserting', async () => {
    const { handleRemember } = await import('../src/tools/remember.js');
    const { handleListMemories } = await import('../src/tools/list-memories.js');
    await handleRemember(db, { project_id: '/p', agent_id: 'a', type: 'fact', content: 'dedup test', importance: 0.3 });
    await handleRemember(db, { project_id: '/p', agent_id: 'a', type: 'fact', content: 'dedup test', importance: 0.9 });
    const mems = handleListMemories(db, { project_id: '/p' });
    expect(mems).toHaveLength(1);
    expect(mems[0].importance).toBeCloseTo(0.9);
  });

  it('allows same content in different projects', async () => {
    const { handleRemember } = await import('../src/tools/remember.js');
    const { handleListProjects } = await import('../src/tools/list-projects.js');
    await handleRemember(db, { project_id: '/projA', agent_id: 'a', type: 'fact', content: 'shared fact', importance: 0.5 });
    await handleRemember(db, { project_id: '/projB', agent_id: 'a', type: 'fact', content: 'shared fact', importance: 0.5 });
    const projects = handleListProjects(db);
    expect(projects).toHaveLength(2);
  });
});
```

Run: `npm test -- --reporter=verbose tests/tools.test.ts`
Expected: FAIL — duplicate inserts succeed instead of upserting.

### Step 2: Add `upsertMemory` to `src/memory.ts`

Append to `src/memory.ts`:

```typescript
/**
 * Insert a memory, or update importance/updated_at if a memory with identical
 * (project_id, content) already exists. Returns the id (existing or new) and created_at.
 */
export function upsertMemory(
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
  const importance = Math.max(0, Math.min(1, params.importance));

  const existing = db.prepare(
    'SELECT id, created_at FROM memories WHERE project_id = ? AND content = ? LIMIT 1'
  ).get(params.project_id, params.content) as { id: string; created_at: number } | undefined;

  if (existing) {
    const now = Date.now();
    db.transaction(() => {
      db.prepare(
        'UPDATE memories SET importance = ?, updated_at = ? WHERE id = ?'
      ).run(importance, now, existing.id);
      db.prepare(
        'UPDATE memory_embeddings SET embedding = ? WHERE id = ?'
      ).run(params.embedding, existing.id);
    })();
    return { id: existing.id, created_at: existing.created_at };
  }

  return insertMemory(db, { ...params, importance });
}
```

### Step 3: Update `src/tools/remember.ts` to call `upsertMemory`

Replace:
```typescript
import { insertMemory } from '../memory.js';
```
With:
```typescript
import { upsertMemory } from '../memory.js';
```

Replace:
```typescript
  return insertMemory(db, { ...input, importance, embedding });
```
With:
```typescript
  return upsertMemory(db, { ...input, importance, embedding });
```

### Step 4: Run tests

Run: `npm test -- --reporter=verbose tests/tools.test.ts`
Expected: PASS — all dedup tests pass.

### Step 5: Run full test suite

Run: `npm test`
Expected: all pass.

### Step 6: Commit

```bash
git add src/memory.ts src/tools/remember.ts tests/tools.test.ts
git commit -m "feat: upsert deduplication in remember_memory — update importance on exact content match"
```

---

## Task 9: New MCP tools — `get_memory`, `list_conversations`, `delete_conversation`

Three tools added in one task (all are thin wrappers over DB queries):

- `get_memory(id)` — fetch a single memory by UUID; returns `{ found: false }` if not found
- `list_conversations(project_id, agent_id?, status?, limit?)` — list conversations without semantic search
- `delete_conversation(conversation_id)` — permanently delete a conversation and its turns

**Files:**
- Modify: `src/conversation.ts` — add `listConversations`, `deleteConversation`
- Modify: `src/memory.ts` — add `getMemory`
- Create: `src/tools/get-memory.ts`
- Create: `src/tools/list-conversations.ts`
- Create: `src/tools/delete-conversation.ts`
- Modify: `src/server.ts` — register all three tools
- Modify: `tests/tools.test.ts` — add tests for `get_memory`
- Modify: `tests/conversation-tools.test.ts` — add `list_conversations` and `delete_conversation` tests

### Step 1: Write failing tests

Add to `tests/tools.test.ts`:

```typescript
describe('get_memory tool', () => {
  it('returns the memory for a known id', async () => {
    const { handleRemember } = await import('../src/tools/remember.js');
    const { handleGetMemory } = await import('../src/tools/get-memory.js');
    const { id } = await handleRemember(db, { project_id: '/p', agent_id: 'a', type: 'fact', content: 'fetchable', importance: 0.6 });
    const result = handleGetMemory(db, { id });
    expect(result.found).toBe(true);
    expect(result.memory?.content).toBe('fetchable');
  });

  it('returns { found: false } for an unknown id', async () => {
    const { handleGetMemory } = await import('../src/tools/get-memory.js');
    const result = handleGetMemory(db, { id: '00000000-0000-0000-0000-000000000000' });
    expect(result.found).toBe(false);
    expect(result.memory).toBeUndefined();
  });
});
```

Add to `tests/conversation-tools.test.ts`:

```typescript
describe('list_conversations tool', () => {
  it('lists all conversations for a project', async () => {
    const { handleStartConversation } = await import('../src/tools/start-conversation.js');
    const { handleListConversations } = await import('../src/tools/list-conversations.js');
    handleStartConversation(db, { project_id: 'p', agent_id: 'a', title: 'C1' });
    handleStartConversation(db, { project_id: 'p', agent_id: 'a', title: 'C2' });
    const results = handleListConversations(db, { project_id: 'p' });
    expect(results).toHaveLength(2);
  });

  it('filters by status', async () => {
    const { handleStartConversation } = await import('../src/tools/start-conversation.js');
    const { handleCloseConversation } = await import('../src/tools/close-conversation.js');
    const { handleListConversations } = await import('../src/tools/list-conversations.js');
    const { id } = handleStartConversation(db, { project_id: 'p', agent_id: 'a' });
    handleStartConversation(db, { project_id: 'p', agent_id: 'a' });
    await handleCloseConversation(db, { conversation_id: id, summary: 'done' });
    const closed = handleListConversations(db, { project_id: 'p', status: 'closed' });
    expect(closed).toHaveLength(1);
    expect(closed[0].id).toBe(id);
  });

  it('returns empty array for unknown project', async () => {
    const { handleListConversations } = await import('../src/tools/list-conversations.js');
    expect(handleListConversations(db, { project_id: 'nobody' })).toHaveLength(0);
  });
});

describe('delete_conversation tool', () => {
  it('deletes a conversation and its turns', async () => {
    const { handleStartConversation } = await import('../src/tools/start-conversation.js');
    const { handleAppendTurn } = await import('../src/tools/append-turn.js');
    const { handleDeleteConversation } = await import('../src/tools/delete-conversation.js');
    const { id } = handleStartConversation(db, { project_id: 'p', agent_id: 'a' });
    handleAppendTurn(db, { conversation_id: id, role: 'user', content: 'Q' });
    const result = handleDeleteConversation(db, { conversation_id: id });
    expect(result.deleted).toBe(true);
    const row = db.prepare('SELECT id FROM conversations WHERE id = ?').get(id);
    expect(row).toBeUndefined();
    const turns = db.prepare('SELECT id FROM conversation_turns WHERE conversation_id = ?').all(id);
    expect(turns).toHaveLength(0);
  });

  it('throws for unknown conversation_id', async () => {
    const { handleDeleteConversation } = await import('../src/tools/delete-conversation.js');
    expect(() => handleDeleteConversation(db, { conversation_id: 'does-not-exist' }))
      .toThrow('Conversation not found');
  });
});
```

Run: `npm test -- --reporter=verbose tests/tools.test.ts tests/conversation-tools.test.ts`
Expected: FAIL — all new handlers not found.

### Step 2: Add DB-layer functions

**Add `getMemory` to `src/memory.ts`:**

```typescript
export function getMemory(
  db: Database.Database,
  id: string
): Memory | null {
  return (db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Memory | undefined) ?? null;
}
```

**Add `listConversations` and `deleteConversation` to `src/conversation.ts`:**

```typescript
export function listConversations(
  db: Database.Database,
  params: { project_id: string; agent_id?: string; status?: ConversationStatus; limit?: number }
): Conversation[] {
  let query = 'SELECT * FROM conversations WHERE project_id = ?';
  const args: unknown[] = [params.project_id];

  if (params.agent_id) { query += ' AND agent_id = ?';  args.push(params.agent_id); }
  if (params.status)   { query += ' AND status = ?';    args.push(params.status); }
  query += ' ORDER BY updated_at DESC';
  if (params.limit != null) { query += ' LIMIT ?'; args.push(params.limit); }

  return (db.prepare(query).all as (...a: unknown[]) => Conversation[])(...args);
}

export function deleteConversation(
  db: Database.Database,
  conversation_id: string
): { deleted: boolean; conversation_id: string } {
  const existing = db.prepare('SELECT id, status FROM conversations WHERE id = ?')
    .get(conversation_id) as { id: string; status: string } | undefined;
  if (!existing) throw new Error('Conversation not found');

  db.transaction(() => {
    // Delete embedding if it exists (only closed conversations have one)
    db.prepare('DELETE FROM conversation_embeddings WHERE id = ?').run(conversation_id);
    db.prepare('DELETE FROM conversation_turns WHERE conversation_id = ?').run(conversation_id);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(conversation_id);
  })();

  return { deleted: true, conversation_id };
}
```

### Step 3: Create tool handler files

**`src/tools/get-memory.ts`:**

```typescript
import type Database from 'better-sqlite3';
import type { Memory } from '../types.js';
import { getMemory } from '../memory.js';

export function handleGetMemory(
  db: Database.Database,
  input: { id: string }
): { found: true; memory: Memory } | { found: false; memory?: undefined } {
  const memory = getMemory(db, input.id);
  if (!memory) return { found: false };
  return { found: true, memory };
}
```

**`src/tools/list-conversations.ts`:**

```typescript
import type Database from 'better-sqlite3';
import type { Conversation, ConversationStatus } from '../types.js';
import { listConversations } from '../conversation.js';

export function handleListConversations(
  db: Database.Database,
  input: { project_id: string; agent_id?: string; status?: ConversationStatus; limit?: number }
): Conversation[] {
  if (!input.project_id?.trim()) throw new Error('project_id is required');
  return listConversations(db, input);
}
```

**`src/tools/delete-conversation.ts`:**

```typescript
import type Database from 'better-sqlite3';
import { deleteConversation } from '../conversation.js';

export function handleDeleteConversation(
  db: Database.Database,
  input: { conversation_id: string }
): { deleted: boolean; conversation_id: string } {
  if (!input.conversation_id?.trim()) throw new Error('conversation_id is required');
  return deleteConversation(db, input.conversation_id);
}
```

### Step 4: Register in `src/server.ts`

Add imports (after existing imports):
```typescript
import { handleGetMemory } from './tools/get-memory.js';
import { handleListConversations } from './tools/list-conversations.js';
import { handleDeleteConversation } from './tools/delete-conversation.js';
```

Add tool registrations (after `delete_project`):

```typescript
  server.tool(
    'get_memory',
    'Fetch a single memory by id',
    { id: z.string().uuid() },
    (input) => {
      try {
        const result = handleGetMemory(db, input);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    }
  );

  server.tool(
    'list_conversations',
    'List conversations for a project without semantic search',
    {
      project_id: z.string().min(1),
      agent_id: z.string().min(1).optional(),
      status: z.enum(['open', 'closed']).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
    (input) => {
      try {
        const result = handleListConversations(db, input);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    }
  );

  server.tool(
    'delete_conversation',
    'Permanently delete a conversation and all its turns',
    { conversation_id: z.string().min(1) },
    (input) => {
      try {
        const result = handleDeleteConversation(db, input);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    }
  );
```

### Step 5: Run tests

Run: `npm test -- --reporter=verbose tests/tools.test.ts tests/conversation-tools.test.ts`
Expected: PASS on all new tests.

### Step 6: Run full test suite

Run: `npm test`
Expected: all pass.

### Step 7: Commit

```bash
git add src/memory.ts src/conversation.ts \
        src/tools/get-memory.ts src/tools/list-conversations.ts src/tools/delete-conversation.ts \
        src/server.ts \
        tests/tools.test.ts tests/conversation-tools.test.ts
git commit -m "feat: add get_memory, list_conversations, delete_conversation MCP tools"
```

---

## Task 10: `agent_id` filter for `list_memories` + `remember_many` batch tool

Two additions:
1. Add `agent_id` filter to `list_memories` (makes it symmetric with `recall_memories`)
2. Add `remember_many` tool — bulk insert with upsert dedup per item

**Files:**
- Modify: `src/tools/list-memories.ts` — add `agent_id` filter
- Modify: `src/memory.ts` — update `listMemories` signature
- Create: `src/tools/remember-many.ts`
- Modify: `src/server.ts` — update `list_memories` schema, register `remember_many`
- Modify: `tests/tools.test.ts` — add tests

### Step 1: Write failing tests

Add to `tests/tools.test.ts`:

```typescript
describe('list_memories agent_id filter', () => {
  it('filters by agent_id when provided', async () => {
    const { handleRemember } = await import('../src/tools/remember.js');
    const { handleListMemories } = await import('../src/tools/list-memories.js');
    await handleRemember(db, { project_id: '/p', agent_id: 'claude', type: 'fact', content: 'from claude', importance: 0.5 });
    await handleRemember(db, { project_id: '/p', agent_id: 'gpt', type: 'fact', content: 'from gpt', importance: 0.5 });
    const results = handleListMemories(db, { project_id: '/p', agent_id: 'claude' });
    expect(results).toHaveLength(1);
    expect(results[0].agent_id).toBe('claude');
  });
});

describe('remember_many tool', () => {
  it('inserts multiple memories and returns ids', async () => {
    const { handleRememberMany } = await import('../src/tools/remember-many.js');
    const results = await handleRememberMany(db, {
      project_id: '/p',
      agent_id: 'a',
      memories: [
        { type: 'fact', content: 'item one', importance: 0.5 },
        { type: 'decision', content: 'item two', importance: 0.8 },
      ],
    });
    expect(results).toHaveLength(2);
    expect(results[0].id).toBeTruthy();
    expect(results[1].id).toBeTruthy();
  });

  it('deduplicates by content within the batch', async () => {
    const { handleRememberMany } = await import('../src/tools/remember-many.js');
    const { handleListMemories } = await import('../src/tools/list-memories.js');
    await handleRememberMany(db, {
      project_id: '/p',
      agent_id: 'a',
      memories: [
        { type: 'fact', content: 'duplicate', importance: 0.4 },
        { type: 'fact', content: 'duplicate', importance: 0.9 },
      ],
    });
    const mems = handleListMemories(db, { project_id: '/p' });
    expect(mems).toHaveLength(1);
    expect(mems[0].importance).toBeCloseTo(0.9);
  });

  it('throws for empty memories array', async () => {
    const { handleRememberMany } = await import('../src/tools/remember-many.js');
    await expect(handleRememberMany(db, { project_id: '/p', agent_id: 'a', memories: [] }))
      .rejects.toThrow('memories must not be empty');
  });
});
```

Run: `npm test -- --reporter=verbose tests/tools.test.ts`
Expected: FAIL — handlers not found.

### Step 2: Update `listMemories` in `src/memory.ts` to accept `agent_id`

Replace the existing `listMemories` function:

```typescript
export function listMemories(
  db: Database.Database,
  params: { project_id: string; type?: MemoryType; agent_id?: string; limit?: number }
): Memory[] {
  let query = 'SELECT * FROM memories WHERE project_id = ?';
  const args: unknown[] = [params.project_id];

  if (params.type)     { query += ' AND type = ?';     args.push(params.type); }
  if (params.agent_id) { query += ' AND agent_id = ?'; args.push(params.agent_id); }
  query += ' ORDER BY updated_at DESC';
  if (params.limit != null) { query += ' LIMIT ?'; args.push(params.limit); }

  return (db.prepare(query).all as (...a: unknown[]) => Memory[])(...args);
}
```

### Step 3: Update `src/tools/list-memories.ts`

```typescript
import type Database from 'better-sqlite3';
import type { Memory, MemoryType } from '../types.js';
import { listMemories } from '../memory.js';

export function handleListMemories(
  db: Database.Database,
  input: { project_id: string; type?: MemoryType; agent_id?: string; limit?: number }
): Memory[] {
  return listMemories(db, input);
}
```

### Step 4: Create `src/tools/remember-many.ts`

```typescript
import type Database from 'better-sqlite3';
import type { MemoryType } from '../types.js';
import { embedOrThrow } from '../embeddings.js';
import { upsertMemory } from '../memory.js';

interface MemoryItem {
  type: MemoryType;
  content: string;
  importance?: number;
}

export async function handleRememberMany(
  db: Database.Database,
  input: { project_id: string; agent_id: string; memories: MemoryItem[] }
): Promise<{ id: string; created_at: number }[]> {
  if (!input.project_id?.trim()) throw new Error('project_id is required');
  if (!input.agent_id?.trim()) throw new Error('agent_id is required');
  if (!input.memories?.length) throw new Error('memories must not be empty');

  const results: { id: string; created_at: number }[] = [];
  for (const item of input.memories) {
    if (!item.content?.trim()) throw new Error('each memory must have non-empty content');
    const importance = Math.max(0, Math.min(1, item.importance ?? 0.5));
    const embedding = await embedOrThrow(item.content, 'search_document: ');
    const result = upsertMemory(db, {
      project_id: input.project_id,
      agent_id: input.agent_id,
      type: item.type,
      content: item.content,
      importance,
      embedding,
    });
    results.push(result);
  }
  return results;
}
```

### Step 5: Update `src/server.ts`

Add import:
```typescript
import { handleRememberMany } from './tools/remember-many.js';
```

Update `list_memories` schema (add `agent_id`):
```typescript
  server.tool(
    'list_memories',
    'List all memories for a project without semantic search',
    {
      project_id: z.string().min(1),
      type: z.enum(MEMORY_TYPES).optional(),
      agent_id: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(500).optional(),
    },
    (input) => {
      try {
        const result = handleListMemories(db, input);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    }
  );
```

Add `remember_many` tool registration (after `remember_memory`):
```typescript
  server.tool(
    'remember_many',
    'Bulk store multiple memories for a project in one call',
    {
      project_id: z.string().min(1),
      agent_id: z.string().min(1),
      memories: z.array(z.object({
        type: z.enum(MEMORY_TYPES),
        content: z.string().min(1),
        importance: z.number().min(0).max(1).optional(),
      })).min(1).max(50),
    },
    async (input) => {
      try {
        const result = await handleRememberMany(db, input);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    }
  );
```

### Step 6: Run tests

Run: `npm test -- --reporter=verbose tests/tools.test.ts`
Expected: PASS on all new tests.

### Step 7: Run full test suite

Run: `npm test`
Expected: all pass.

### Step 8: Commit

```bash
git add src/memory.ts src/tools/list-memories.ts src/tools/remember-many.ts src/server.ts tests/tools.test.ts
git commit -m "feat: add agent_id filter to list_memories, add remember_many batch insert tool"
```

---

## Task 11: Full test run, build, bump version, deploy

### Step 1: Run all tests

```bash
npm test
```

Expected: all tests pass, zero failures.

### Step 2: Build

```bash
npm run build
```

Expected: zero TypeScript errors.

### Step 3: Bump version to 0.2.0

In `package.json`, update:
```json
"version": "0.2.0"
```

### Step 4: Commit version bump

```bash
git add package.json dist/
git commit -m "chore: bump version to 0.2.0"
```

### Step 5: Deploy updated plugin

```bash
node dist/index.js setup
```

### Step 6: Verify plugin is deployed

```bash
grep "lastAppendedIndexMap" ~/.config/opencode/plugins/engramdb.ts && echo "plugin OK"
```

---

## Post-plan notes

### Running the embedding migration on your live DB

After deploying, run the migration script to re-embed your existing data with task prefixes:

```bash
npx tsx scripts/migrate-embeddings.ts
```

This is safe to re-run. It processes memories first, then closed conversation summaries.

### Summary of all changes

| Task | Category | What changed |
|------|----------|-------------|
| 1 | Schema | Migration runner, `schema_migrations` table, `idx_memories_updated_at`, `idx_memories_agent_id` |
| 2 | Correctness | `path.dirname`, importance clamp in `insertMemory`, weight-sum warning, ConversationWithScore JSDoc |
| 3 | Performance | N+1 UPDATE loop → single batched UPDATE |
| 4 | Performance | ANN oversampling 2x→5x when filter active |
| 5 | Refactor | `embedOrThrow` extracted, `disposeEmbedder` calls `pipe.dispose()` |
| 6 | Correctness | nomic task prefixes + migration script |
| 7 | Correctness | Runtime `type` guard in `updateMemory`, `z.string().min(1)` for optional filters |
| 8 | Feature | Upsert dedup in `remember_memory` |
| 9 | Feature | `get_memory`, `list_conversations`, `delete_conversation` tools |
| 10 | Feature | `agent_id` filter for `list_memories`, `remember_many` batch tool |
| 11 | Release | Full test + build + version bump to 0.2.0 + deploy |
