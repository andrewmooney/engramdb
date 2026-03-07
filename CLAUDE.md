# engramdb — AI Assistant Guide

engramdb is a **persistent, semantically-searchable memory MCP server** for AI coding agents. It stores memories and conversations in SQLite with 768-dimensional vector embeddings (nomic-embed-text-v1) for semantic similarity search.

## Project Overview

- **Language**: TypeScript 5.9.3 (strict, ESM-only, Node16 module resolution)
- **Runtime**: Node.js ≥ 20
- **Database**: SQLite (WAL mode) + sqlite-vec for vector search
- **Protocol**: MCP (Model Context Protocol) over stdio or HTTP/SSE
- **Version**: 0.2.3

## Commands

```bash
npm run build        # Compile TypeScript → dist/
npm run dev          # Run from source via tsx (no build step)
npm test             # Run all tests once with vitest
npm run test:watch   # Run tests in watch mode
```

> The first run downloads the ~270 MB `nomic-embed-text-v1` model. This is expected.

## CLI Usage

```bash
engramdb              # Start MCP server (default: stdio transport)
engramdb setup        # Auto-configure detected AI clients
engramdb --version    # Print version and exit
engramdb -v           # Same as --version
```

**Transport selection** (via `MCP_TRANSPORT` env var):
- `stdio` (default) — communicates over stdin/stdout; used by most MCP clients
- `http` — starts an Express HTTP/SSE server on `MCP_PORT` (default 3456)

**`engramdb setup`** detects installed AI clients and writes the appropriate config files:

| Client | Detection path | Files written |
|--------|---------------|---------------|
| OpenCode | `~/.config/opencode/` | `plugins/engramdb.ts` + `AGENTS.md` update |
| Claude Code | `~/.claude/` | `CLAUDE.md` update |
| Cursor | `~/.cursor/` | `.cursor/rules/engramdb.md` |
| VS Code Copilot | `~/.vscode/` | `.github/copilot-instructions.md` update |
| Claude Desktop | detected only | prints manual config reminder |

The setup command is idempotent — it checks for the sentinel `## Memory (engramdb)` before appending and skips if already present.

## Repository Structure

```
src/
  index.ts            # CLI entry point; handles setup command, --version, transport selection
  server.ts           # MCP server; registers all 18 tools with Zod input schemas
  db.ts               # Database factory: loads sqlite-vec, creates schema, runs migrations
  types.ts            # Core interfaces: Memory, MemoryWithScore, Conversation, ConversationTurn
  memory.ts           # Memory CRUD + vector query logic
  embeddings.ts       # Singleton embedder (lazy-loaded Hugging Face model)
  conversation.ts     # Conversation CRUD + semantic search of closed conversations
  setup.ts            # Auto-configures clients: OpenCode, Claude Code, Cursor, GitHub Copilot
  version.ts          # Reads version from package.json via createRequire
  migrations/
    index.ts          # Runs pending migrations in order
    001_add_indexes.ts # Adds updated_at and agent_id indexes
  tools/              # One file per MCP tool handler (17 files)
    remember.ts, remember-many.ts, recall.ts, search-global.ts,
    update.ts, delete-memory.ts, delete-project.ts, list-projects.ts,
    list-memories.ts, get-memory.ts, start-conversation.ts,
    append-turn.ts, close-conversation.ts, get-conversation.ts,
    list-conversations.ts, delete-conversation.ts, search-conversations.ts

tests/                # Vitest test suites
  db.test.ts, embeddings.test.ts, memory.test.ts, tools.test.ts,
  conversation-tools.test.ts
src/
  conversation.test.ts, setup.test.ts

scripts/
  migrate-embeddings.ts  # One-off script to re-embed all existing memories

docs/plans/           # Design documents for past/future features
.github/
  copilot-instructions.md  # GitHub Copilot + mtmem/engramdb guidance
```

## Architecture

### Database Schema

Two domains, each with a main table and a paired vec0 virtual table:

**Memory domain:**
- `memories` — stores content, project_id, agent_id, type, importance, timestamps
- `memory_embeddings` (vec0) — stores float[768] embedding per memory id

**Conversation domain:**
- `conversations` — metadata, status (open/closed), summary, denormalized `turn_count`
- `conversation_turns` — individual dialogue turns with role/content/turn_index
- `conversation_embeddings` (vec0) — embedding of the closed conversation summary

> **Critical**: vec0 virtual tables do not support foreign key constraints. The application layer (not the DB) must keep these tables in sync. Always delete from the vec0 table before the main table; always insert into both within a `db.transaction()`.

### Embedding Model

`src/embeddings.ts` provides a lazy singleton:

```typescript
getEmbedder()   // returns Promise<embedder>, initializes once
embed(texts)    // generates Float32Array[768] per text
embedOrThrow()  // same but throws with [engramdb] prefix on failure
disposeEmbedder() // cleanup for ONNX sessions
```

Task prefixes are applied automatically:
- Documents stored: `search_document: ` prefix
- Queries: `search_query: ` prefix

### Memory Scoring

Retrieval uses composite scoring across three signals:

```
score = W_SIM × similarity + W_IMP × importance + W_REC × recency_decay
```

Defaults (configurable via env vars):
- `ENGRAMDB_W_SIM=0.6` — vector cosine similarity weight
- `ENGRAMDB_W_IMP=0.25` — user-assigned importance weight
- `ENGRAMDB_W_REC=0.15` — recency decay weight
- `ENGRAMDB_DECAY_LAMBDA=0.01` — controls decay rate (days)

Similarity conversion from L2 distance: `similarity = 1 - (distance² / 2)`

Oversampling: vector search fetches `limit × 5` candidates (when filters active) or `limit × 2` before re-scoring and slicing.

**Access tracking**: every `queryMemories` call batch-updates `last_accessed_at` and increments `access_count` for the returned memories. This feeds the recency signal in subsequent retrievals.

### MCP Tools (18 total)

**Memory tools:**
| Tool | Key parameters | Notes |
|------|---------------|-------|
| `remember_memory` | `project_id`, `agent_id`, `type`, `content`, `importance?` | Upserts on exact `(project_id, content)` match |
| `remember_many` | `project_id`, `agent_id`, `memories[]` | Batch upsert; max 50 items per call |
| `recall_memories` | `project_id`, `query`, `limit?`, `type?`, `agent_id?` | Semantic search; limit 1–50 |
| `search_global` | `query`, `limit?` | Searches memories only (not conversations); limit 1–50 |
| `update_memory` | `id` (UUID), `content?`, `importance?`, `type?` | At least one of content/importance/type required |
| `delete_memory` | `id` (UUID) | Throws if not found |
| `delete_project` | `project_id` | Deletes all memories for that project |
| `list_projects` | — | Returns project_id, memory_count, last_updated_at |
| `list_memories` | `project_id`, `type?`, `agent_id?`, `limit?` | No vector search; ordered by updated_at DESC; limit up to 500 |
| `get_memory` | `id` (UUID) | Returns null if not found |

**Conversation tools:**
| Tool | Key parameters | Notes |
|------|---------------|-------|
| `start_conversation` | `project_id`, `agent_id`, `title?` | Returns `conversation_id` |
| `append_turn` | `conversation_id`, `role`, `content` | Role: `user \| assistant \| tool`; conversation must be open |
| `close_conversation` | `conversation_id`, `summary` | Embeds summary for future semantic search; marks status `closed` |
| `get_conversation` | `conversation_id` | Returns conversation metadata + all turns |
| `list_conversations` | `project_id`, `agent_id?`, `status?`, `limit?` | Status filter: `open \| closed`; limit up to 200 |
| `delete_conversation` | `conversation_id` | Deletes conversation, all turns, and embedding |
| `search_conversations` | `query`, `project_id?`, `limit?` | Only searches closed conversations; limit 1–50 |

**Utility:**
| Tool | Notes |
|------|-------|
| `get_version` | Returns `{ version: "x.y.z" }` |

### Conversation Lifecycle

```
start_conversation → append_turn (×N) → close_conversation → search_conversations
```

1. `start_conversation` — returns `conversation_id`; conversation status is `open`
2. `append_turn` — add turns with role `user`, `assistant`, or `tool`; can only append to open conversations
3. `close_conversation` — provide a summary string; it gets embedded and the conversation becomes `closed`
4. `search_conversations` — semantic search over closed conversation summaries; open conversations are excluded

## Code Conventions

### Naming
- Functions: `camelCase` (`insertMemory`, `queryMemories`)
- Types/interfaces: `PascalCase` (`Memory`, `MemoryWithScore`)
- Tool files: `kebab-case` (`remember-many.ts`, `delete-memory.ts`)
- DB tables/columns: `snake_case` (`project_id`, `last_accessed_at`)
- Env vars: `SCREAMING_SNAKE_CASE` (`ENGRAMDB_DB_PATH`)

### ESM Imports
All imports use `.js` extensions — this is a Node16 ESM TypeScript project:
```typescript
import { insertMemory } from './memory.js';  // correct
import { insertMemory } from './memory';     // wrong — will fail at runtime
```

### Tool Handler Pattern
Each tool in `src/tools/` exports a `handle*` function:
1. Receives validated inputs (Zod schemas in `server.ts`)
2. Calls embedding if needed (`embed()` / `embedOrThrow()`)
3. Calls a function from `memory.ts` or `conversation.ts`
4. Returns a JSON-serializable result

### Database Transactions
Paired insert/delete operations (main table + vec0 table) must always be wrapped in `db.transaction()`.

### Memory Types
Valid values for the `type` field:
`fact` | `code_pattern` | `preference` | `decision` | `task` | `observation`

### Importance Scale
- `0.9` — project-wide conventions, hard constraints
- `0.7` — common patterns, repeated preferences
- `0.5` — session-specific notes, one-off observations

## Testing

Tests use:
- **Vitest** as the test runner
- **In-memory SQLite** (`:memory:`) for isolation — no files created
- **Mocked embeddings** via `vi.mock()` returning `Float32Array(768).fill(0.1)` — no model download needed

```bash
npm test             # one-shot run
npm run test:watch   # interactive watch mode
```

When adding a new tool or feature:
1. Add unit tests in `tests/` (or `src/*.test.ts` for smaller modules)
2. Mock `src/embeddings.js` if the code under test calls `embed()`
3. Use `createDb(':memory:')` for database tests

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ENGRAMDB_DB_PATH` | `~/.global-agent-memory.db` | Database file path |
| `MCP_TRANSPORT` | `stdio` | Transport mode: `stdio` or `http` |
| `MCP_PORT` | `3456` | HTTP port (only for `http` mode) |
| `ENGRAMDB_W_SIM` | `0.6` | Similarity weight (must sum to ~1.0 with W_IMP + W_REC) |
| `ENGRAMDB_W_IMP` | `0.25` | Importance weight |
| `ENGRAMDB_W_REC` | `0.15` | Recency weight |
| `ENGRAMDB_DECAY_LAMBDA` | `0.01` | Recency decay rate (per day) |

## Adding a New MCP Tool

1. Create `src/tools/<tool-name>.ts` exporting a `handle*` function
2. Register it in `src/server.ts`:
   - Add Zod schema for inputs
   - Add a case in the tool dispatch switch
3. Add tests in `tests/tools.test.ts` or a new file
4. Document in `README.md`

## Adding a Database Migration

1. Create `src/migrations/00N_<description>.ts` following the pattern in `001_add_indexes.ts`:
   - Export `up(db: Database.Database): void`
   - Check for existence before applying (idempotent)
2. Register it in `src/migrations/index.ts`

Migrations run automatically on `createDb()`. They must be idempotent (`CREATE INDEX IF NOT EXISTS`, etc.).

## Key Gotchas

- **sqlite-vec requires platform-specific native bindings.** If `load(db)` throws, the package is not installed correctly for the current platform.
- **vec0 tables have no FK support.** Always manage `memory_embeddings` and `conversation_embeddings` manually alongside their parent tables.
- **`turn_count` is denormalized.** When appending turns, the application layer increments it explicitly — don't rely on a DB trigger.
- **Weights must sum to ~1.0.** The server logs a warning to stderr at startup if they don't.
- **Lazy embedder initialization.** The model loads on first call to `getEmbedder()`. Expect ~3–10 seconds and ~270 MB of disk on first use.
- **Upsert semantics.** `remember_memory` (and `remember_many`) deduplicate on exact `(project_id, content)` match — not on meaning. Semantically similar but textually different memories will both be stored.
