# Plugin Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix four known issues in the engramdb plugin and MCP server: sync the stale plugin source in `setup.ts` with the installed plugin, replace the deprecated `session.idle` event with `session.status`, add delete/management MCP tools, and keep the installed plugin in sync with source after each change.

**Architecture:** Three independent workstreams — (1) source sync + event fix in `src/setup.ts`, (2) new handler files + wiring in `src/tools/` and `src/server.ts`, (3) tests and final verification. The installed plugin at `~/.config/opencode/plugins/engramdb.ts` must be updated in lockstep with `src/setup.ts`.

**Tech Stack:** TypeScript, Vitest (tests), better-sqlite3, @modelcontextprotocol/sdk (server.ts), Bun/OpenCode plugin API (setup.ts)

---

## Task 1: Sync `OPENCODE_PLUGIN_SOURCE` in `setup.ts` with the installed plugin

The installed plugin at `~/.config/opencode/plugins/engramdb.ts` is ahead of the source in `OPENCODE_PLUGIN_SOURCE` (inside `src/setup.ts`). The source still uses:
- `lastAppendedMap` (tracks last appended message ID, assistant-only)

The installed plugin uses:
- `lastAppendedIndexMap` (tracks index, appends both user and assistant turns)

**Files:**
- Modify: `src/setup.ts` (the `OPENCODE_PLUGIN_SOURCE` constant, lines 18–111)

**Step 1: Write a failing test that asserts the plugin source contains `lastAppendedIndexMap`**

Add this test to `src/setup.test.ts`:

```typescript
it('OPENCODE_PLUGIN_SOURCE uses index-based dedup (lastAppendedIndexMap)', async () => {
  const { OPENCODE_PLUGIN_SOURCE } = await import('./setup.js')
  expect(OPENCODE_PLUGIN_SOURCE).toContain('lastAppendedIndexMap')
  expect(OPENCODE_PLUGIN_SOURCE).not.toContain('lastAppendedMap')
})
```

Note: `OPENCODE_PLUGIN_SOURCE` is not currently exported. You'll need to export it.

**Step 2: Run test to verify it fails**

```bash
npm test -- --reporter=verbose src/setup.test.ts
```

Expected: FAIL — `OPENCODE_PLUGIN_SOURCE is not exported` or contains wrong content.

**Step 3: Export `OPENCODE_PLUGIN_SOURCE` and update its content**

In `src/setup.ts`, change the declaration from:

```typescript
const OPENCODE_PLUGIN_SOURCE = `...`
```

to:

```typescript
export const OPENCODE_PLUGIN_SOURCE = `...`
```

Then replace the full body of the plugin source template string to match the installed plugin exactly. The installed plugin is at `~/.config/opencode/plugins/engramdb.ts`. The key changes are:

Replace this block (around line 22):
```typescript
const lastAppendedMap = new Map<string, string>()
```

With:
```typescript
// Tracks the index (exclusive) of the last message we've already appended per session.
// On session.idle we append all messages from this index onwards.
const lastAppendedIndexMap = new Map<string, number>()
```

Replace the `session.idle` body (around lines 63–77):
```typescript
const lastAssistant = [...all].reverse().find((m) => m.info?.role === "assistant")
if (!lastAssistant) return
const msgId = lastAssistant.info?.id
if (msgId && lastAppendedMap.get(sessionID) === msgId) return
const content = (lastAssistant.parts ?? []).filter((p) => p.type === "text").map((p) => (p as { text?: string }).text ?? "").join("\\n").trim()
if (!content) return
await callMtmem("append_turn", { conversation_id: conversationId, role: "assistant", content })
if (msgId) lastAppendedMap.set(sessionID, msgId)
await client.app.log({ body: { service: "engramdb-plugin", level: "debug", message: "session.idle: turn appended", extra: { sessionID, msgId } } })
```

With:
```typescript
const startIdx = lastAppendedIndexMap.get(sessionID) ?? 0
const unsaved = all.slice(startIdx)
let appended = 0
for (const m of unsaved) {
  const role = m.info?.role
  if (role !== "user" && role !== "assistant") continue
  const content = (m.parts ?? []).filter((p) => p.type === "text").map((p) => (p as { text?: string }).text ?? "").join("\\n").trim()
  if (!content) continue
  await callMtmem("append_turn", { conversation_id: conversationId, role, content })
  appended++
}
if (appended > 0) {
  lastAppendedIndexMap.set(sessionID, startIdx + unsaved.length)
  await client.app.log({ body: { service: "engramdb-plugin", level: "debug", message: \`session.idle: \${appended} turn(s) appended\`, extra: { sessionID, appended } } })
}
```

Replace cleanup references from `lastAppendedMap.delete(sessionId)` to `lastAppendedIndexMap.delete(sessionId)` in both `session.deleted` branches.

**Step 4: Run test to verify it passes**

```bash
npm test -- --reporter=verbose src/setup.test.ts
```

Expected: PASS for new test plus all existing setup tests.

**Step 5: Commit**

```bash
git add src/setup.ts src/setup.test.ts
git commit -m "fix: sync OPENCODE_PLUGIN_SOURCE with installed plugin (index-based dedup, both roles)"
```

---

## Task 2: Replace `session.idle` with `session.status`

`session.idle` is marked deprecated in OpenCode source. The non-deprecated equivalent is `session.status`, which fires with `properties.status.type === "idle"` every time the session transitions to idle (i.e. after each assistant response). This is functionally equivalent but uses the stable event type.

**Files:**
- Modify: `src/setup.ts` (inside `OPENCODE_PLUGIN_SOURCE`)

**Step 1: Add a failing test asserting the plugin uses `session.status`**

Add to `src/setup.test.ts`:

```typescript
it('OPENCODE_PLUGIN_SOURCE uses session.status instead of session.idle', async () => {
  const { OPENCODE_PLUGIN_SOURCE } = await import('./setup.js')
  expect(OPENCODE_PLUGIN_SOURCE).toContain('session.status')
  expect(OPENCODE_PLUGIN_SOURCE).not.toContain('session.idle')
})
```

**Step 2: Run test to verify it fails**

```bash
npm test -- --reporter=verbose src/setup.test.ts
```

Expected: FAIL — plugin still uses `session.idle`.

**Step 3: Update plugin source to use `session.status`**

In `OPENCODE_PLUGIN_SOURCE` inside `src/setup.ts`, replace:

```typescript
} else if (event.type === "session.idle") {
  const sessionID = (event.properties as { sessionID?: string }).sessionID
  if (!sessionID) return
```

With:

```typescript
} else if (event.type === "session.status") {
  const props = event.properties as { sessionID?: string; status?: { type?: string } }
  if (props.status?.type !== "idle") return
  const sessionID = props.sessionID
  if (!sessionID) return
```

The rest of the `session.idle` block is unchanged — only the outer condition and property extraction change.

**Step 4: Run tests to verify they pass**

```bash
npm test -- --reporter=verbose src/setup.test.ts
```

Expected: all setup tests PASS including the new one.

**Step 5: Update the installed plugin**

After the source is correct, run setup to deploy the updated plugin:

```bash
node dist/index.js setup
```

Or manually copy the updated plugin source to `~/.config/opencode/plugins/engramdb.ts`.

**Step 6: Commit**

```bash
git add src/setup.ts src/setup.test.ts
git commit -m "fix: replace deprecated session.idle with session.status in OpenCode plugin"
```

---

## Task 3: Add `delete_memory` MCP tool

**Files:**
- Create: `src/tools/delete-memory.ts`
- Modify: `src/memory.ts` (add `deleteMemory` function)
- Modify: `src/server.ts` (register new tool)
- Modify: `tests/tools.test.ts` (add tests)

**Step 1: Write failing tests**

Add to `tests/tools.test.ts`:

```typescript
describe('delete_memory tool', () => {
  it('deletes an existing memory by id', async () => {
    const { handleRemember } = await import('../src/tools/remember.js')
    const { handleDeleteMemory } = await import('../src/tools/delete-memory.js')
    const { id } = await handleRemember(db, {
      project_id: '/p', agent_id: 'a', type: 'fact', content: 'to delete', importance: 0.5,
    })
    const result = handleDeleteMemory(db, { id })
    expect(result.deleted).toBe(true)
  })

  it('throws for unknown id', async () => {
    const { handleDeleteMemory } = await import('../src/tools/delete-memory.js')
    expect(() => handleDeleteMemory(db, { id: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' }))
      .toThrow('Memory not found')
  })

  it('memory is gone after deletion', async () => {
    const { handleRemember } = await import('../src/tools/remember.js')
    const { handleDeleteMemory } = await import('../src/tools/delete-memory.js')
    const { handleListProjects } = await import('../src/tools/list-projects.js')
    const { id } = await handleRemember(db, {
      project_id: '/p', agent_id: 'a', type: 'fact', content: 'to delete', importance: 0.5,
    })
    handleDeleteMemory(db, { id })
    const projects = handleListProjects(db)
    expect(projects).toHaveLength(0)
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- --reporter=verbose tests/tools.test.ts
```

Expected: FAIL — `handleDeleteMemory` not found.

**Step 3: Add `deleteMemory` to `src/memory.ts`**

Append to `src/memory.ts`:

```typescript
export function deleteMemory(
  db: Database.Database,
  id: string
): { id: string } {
  const existing = db.prepare('SELECT id FROM memories WHERE id = ?').get(id);
  if (!existing) throw new Error(`Memory not found: ${id}`);

  const doDelete = db.transaction(() => {
    db.prepare('DELETE FROM memory_embeddings WHERE id = ?').run(id);
    db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  });
  doDelete();

  return { id };
}
```

Note: `memory_embeddings` must be deleted first because it is a vec0 virtual table that does not support FK constraints — the application layer must keep them in sync manually (see comment in `db.ts`).

**Step 4: Create `src/tools/delete-memory.ts`**

```typescript
import type Database from 'better-sqlite3';
import { deleteMemory } from '../memory.js';

export function handleDeleteMemory(
  db: Database.Database,
  input: { id: string }
): { deleted: boolean; id: string } {
  const result = deleteMemory(db, input.id);
  return { deleted: true, id: result.id };
}
```

**Step 5: Register in `src/server.ts`**

Add import at the top:
```typescript
import { handleDeleteMemory } from './tools/delete-memory.js';
```

Add tool registration after `update_memory` (around line 103):
```typescript
server.tool(
  'delete_memory',
  'Delete a memory by id',
  {
    id: z.string().uuid(),
  },
  (input) => {
    try {
      const result = handleDeleteMemory(db, input);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: msg }], isError: true };
    }
  }
);
```

**Step 6: Run tests to verify they pass**

```bash
npm test -- --reporter=verbose tests/tools.test.ts
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/memory.ts src/tools/delete-memory.ts src/server.ts tests/tools.test.ts
git commit -m "feat: add delete_memory MCP tool"
```

---

## Task 4: Add `delete_project` MCP tool

**Files:**
- Create: `src/tools/delete-project.ts`
- Modify: `src/memory.ts` (add `deleteProject`)
- Modify: `src/server.ts` (register tool)
- Modify: `tests/tools.test.ts` (add tests)

**Step 1: Write failing tests**

Add to `tests/tools.test.ts`:

```typescript
describe('delete_project tool', () => {
  it('deletes all memories for a project', async () => {
    const { handleRemember } = await import('../src/tools/remember.js')
    const { handleDeleteProject } = await import('../src/tools/delete-project.js')
    const { handleListProjects } = await import('../src/tools/list-projects.js')
    await handleRemember(db, { project_id: '/proj', agent_id: 'a', type: 'fact', content: 'mem1', importance: 0.5 })
    await handleRemember(db, { project_id: '/proj', agent_id: 'a', type: 'fact', content: 'mem2', importance: 0.5 })
    const result = handleDeleteProject(db, { project_id: '/proj' })
    expect(result.deleted_count).toBe(2)
    const projects = handleListProjects(db)
    expect(projects).toHaveLength(0)
  })

  it('returns 0 deleted_count for unknown project', async () => {
    const { handleDeleteProject } = await import('../src/tools/delete-project.js')
    const result = handleDeleteProject(db, { project_id: '/nonexistent' })
    expect(result.deleted_count).toBe(0)
  })

  it('only deletes memories for specified project', async () => {
    const { handleRemember } = await import('../src/tools/remember.js')
    const { handleDeleteProject } = await import('../src/tools/delete-project.js')
    const { handleListProjects } = await import('../src/tools/list-projects.js')
    await handleRemember(db, { project_id: '/projA', agent_id: 'a', type: 'fact', content: 'mem A', importance: 0.5 })
    await handleRemember(db, { project_id: '/projB', agent_id: 'a', type: 'fact', content: 'mem B', importance: 0.5 })
    handleDeleteProject(db, { project_id: '/projA' })
    const projects = handleListProjects(db)
    expect(projects).toHaveLength(1)
    expect(projects[0].project_id).toBe('/projB')
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- --reporter=verbose tests/tools.test.ts
```

Expected: FAIL — `handleDeleteProject` not found.

**Step 3: Add `deleteProject` to `src/memory.ts`**

Append to `src/memory.ts`:

```typescript
export function deleteProject(
  db: Database.Database,
  project_id: string
): { project_id: string; deleted_count: number } {
  const ids = (db.prepare('SELECT id FROM memories WHERE project_id = ?').all(project_id) as { id: string }[])
    .map(r => r.id);

  if (ids.length === 0) return { project_id, deleted_count: 0 };

  const doDelete = db.transaction(() => {
    for (const id of ids) {
      db.prepare('DELETE FROM memory_embeddings WHERE id = ?').run(id);
    }
    db.prepare('DELETE FROM memories WHERE project_id = ?').run(project_id);
  });
  doDelete();

  return { project_id, deleted_count: ids.length };
}
```

**Step 4: Create `src/tools/delete-project.ts`**

```typescript
import type Database from 'better-sqlite3';
import { deleteProject } from '../memory.js';

export function handleDeleteProject(
  db: Database.Database,
  input: { project_id: string }
): { deleted_count: number; project_id: string } {
  return deleteProject(db, input.project_id);
}
```

**Step 5: Register in `src/server.ts`**

Add import:
```typescript
import { handleDeleteProject } from './tools/delete-project.js';
```

Add tool after `delete_memory`:
```typescript
server.tool(
  'delete_project',
  'Delete all memories for a project',
  {
    project_id: z.string().min(1),
  },
  (input) => {
    try {
      const result = handleDeleteProject(db, input);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: msg }], isError: true };
    }
  }
);
```

**Step 6: Run tests to verify they pass**

```bash
npm test -- --reporter=verbose tests/tools.test.ts
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/memory.ts src/tools/delete-project.ts src/server.ts tests/tools.test.ts
git commit -m "feat: add delete_project MCP tool"
```

---

## Task 5: Add `list_memories` MCP tool

**Files:**
- Create: `src/tools/list-memories.ts`
- Modify: `src/memory.ts` (add `listMemories`)
- Modify: `src/server.ts` (register tool)
- Modify: `tests/tools.test.ts` (add tests)

**Step 1: Write failing tests**

Add to `tests/tools.test.ts`:

```typescript
describe('list_memories tool', () => {
  it('lists all memories for a project', async () => {
    const { handleRemember } = await import('../src/tools/remember.js')
    const { handleListMemories } = await import('../src/tools/list-memories.js')
    await handleRemember(db, { project_id: '/p', agent_id: 'a', type: 'fact', content: 'mem1', importance: 0.5 })
    await handleRemember(db, { project_id: '/p', agent_id: 'a', type: 'decision', content: 'mem2', importance: 0.8 })
    const results = handleListMemories(db, { project_id: '/p' })
    expect(results).toHaveLength(2)
  })

  it('filters by type', async () => {
    const { handleRemember } = await import('../src/tools/remember.js')
    const { handleListMemories } = await import('../src/tools/list-memories.js')
    await handleRemember(db, { project_id: '/p', agent_id: 'a', type: 'fact', content: 'mem1', importance: 0.5 })
    await handleRemember(db, { project_id: '/p', agent_id: 'a', type: 'decision', content: 'mem2', importance: 0.8 })
    const results = handleListMemories(db, { project_id: '/p', type: 'fact' })
    expect(results).toHaveLength(1)
    expect(results[0].type).toBe('fact')
  })

  it('returns empty array for unknown project', async () => {
    const { handleListMemories } = await import('../src/tools/list-memories.js')
    const results = handleListMemories(db, { project_id: '/nonexistent' })
    expect(results).toHaveLength(0)
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- --reporter=verbose tests/tools.test.ts
```

Expected: FAIL — `handleListMemories` not found.

**Step 3: Add `listMemories` to `src/memory.ts`**

Append to `src/memory.ts`:

```typescript
export function listMemories(
  db: Database.Database,
  params: { project_id: string; type?: MemoryType; limit?: number }
): Memory[] {
  let query = 'SELECT * FROM memories WHERE project_id = ?';
  const args: unknown[] = [params.project_id];

  if (params.type) { query += ' AND type = ?'; args.push(params.type); }
  query += ' ORDER BY updated_at DESC';
  if (params.limit) { query += ' LIMIT ?'; args.push(params.limit); }

  return (db.prepare(query).all as (...a: unknown[]) => Memory[])(...args);
}
```

**Step 4: Create `src/tools/list-memories.ts`**

```typescript
import type Database from 'better-sqlite3';
import type { Memory, MemoryType } from '../types.js';
import { listMemories } from '../memory.js';

export function handleListMemories(
  db: Database.Database,
  input: { project_id: string; type?: MemoryType; limit?: number }
): Memory[] {
  return listMemories(db, input);
}
```

**Step 5: Register in `src/server.ts`**

Add import:
```typescript
import { handleListMemories } from './tools/list-memories.js';
```

Add tool after `list_projects`:
```typescript
server.tool(
  'list_memories',
  'List all memories for a project without semantic search',
  {
    project_id: z.string().min(1),
    type: z.enum(MEMORY_TYPES).optional(),
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

**Step 6: Run tests to verify they pass**

```bash
npm test -- --reporter=verbose tests/tools.test.ts
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/memory.ts src/tools/list-memories.ts src/server.ts tests/tools.test.ts
git commit -m "feat: add list_memories MCP tool"
```

---

## Task 6: Full test run, build, and deploy installed plugin

**Step 1: Run all tests**

```bash
npm test
```

Expected: all tests pass.

**Step 2: Build**

```bash
npm run build
```

Expected: no TypeScript errors, `dist/` updated.

**Step 3: Deploy updated plugin to OpenCode**

Run the setup command to overwrite the installed plugin with the updated source:

```bash
node dist/index.js setup
```

Verify the installed plugin was updated:

```bash
grep "session.status" ~/.config/opencode/plugins/engramdb.ts
grep "lastAppendedIndexMap" ~/.config/opencode/plugins/engramdb.ts
```

Both should produce output.

**Step 4: Final commit**

```bash
git add dist/
git commit -m "chore: rebuild dist after plugin improvements"
```
