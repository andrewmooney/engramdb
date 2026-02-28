# mtmem — Design Document
Date: 2026-03-01

## Overview
An open-source TypeScript MCP server providing persistent, searchable memory for AI coding agents.
Agents store facts, code patterns, decisions, and preferences about a project. On recall, memories
are ranked by a scored combination of semantic similarity, importance, and recency.

Non-goals (v1):
- Authentication / multi-user access control
- Cloud sync or remote storage
- Memory sharing between users
- Automatic memory ingestion

## Architecture
Single TypeScript package. One process, two transport modes (stdio default, HTTP/SSE optional).

Transport selection: MCP_TRANSPORT=http (default: stdio).
HTTP mode: Express server on MCP_PORT (default 3456), SSE endpoint at /mcp.

src/
  index.ts              # Entrypoint — selects transport
  server.ts             # MCP server definition, tool registration
  db.ts                 # SQLite + sqlite-vec setup, WAL, migrations
  embeddings.ts         # Transformers.js nomic-embed-text-v1 wrapper
  memory.ts             # Core memory CRUD + scoring logic
  tools/
    remember.ts
    recall.ts
    search-global.ts
    update.ts
    list-projects.ts

## Data Model

### memories table
id               TEXT PRIMARY KEY       -- uuid v4
project_id       TEXT NOT NULL          -- normalized absolute path
agent_id         TEXT NOT NULL          -- e.g. "opencode", "copilot"
type             TEXT NOT NULL          -- fact|code_pattern|preference|decision|task|observation
content          TEXT NOT NULL
importance       REAL NOT NULL DEFAULT 0.5   -- 0.0–1.0
access_count     INTEGER NOT NULL DEFAULT 0
created_at       INTEGER NOT NULL       -- unix ms
updated_at       INTEGER NOT NULL       -- unix ms
last_accessed_at INTEGER NOT NULL       -- unix ms

### memory_embeddings virtual table (sqlite-vec)
id          TEXT PRIMARY KEY
embedding   float[768]

### Scoring Formula
score = (0.6 × cosine_similarity)
      + (0.25 × importance)
      + (0.15 × recency_decay)

recency_decay = exp(-λ × days_since_access)
λ = 0.01 (default, configurable via MTMEM_DECAY_LAMBDA)

Weights configurable: MTMEM_W_SIM, MTMEM_W_IMP, MTMEM_W_REC

## MCP Tools

### remember_memory
Store a new memory.
Input:  project_id, agent_id, type, content, importance? (default 0.5)
Output: { id, created_at }

### recall_memories
Semantic search within a project. Updates last_accessed_at + access_count on hits.
Input:  project_id, query, limit? (default 10, max 50), type?, agent_id?
Output: [{ id, content, type, importance, score, created_at, last_accessed_at }]

### search_global
Search across all projects.
Input:  query, limit? (default 10, max 50)
Output: [{ id, project_id, content, type, importance, score }]

### update_memory
Edit content (re-embeds), importance, or type.
Input:  id, content?, importance?, type?
Output: { id, updated_at }

### list_projects
List all projects with memory counts.
Input:  (none)
Output: [{ project_id, memory_count, last_updated_at }]

## Error Handling
- Invalid project_id (empty or non-absolute) → structured MCP error, no crash
- update_memory with unknown id → not-found error response
- Embedding failure → MCP error, DB write not attempted
- WAL mode — concurrent stdio + HTTP access is safe

## Startup
- First run: downloads nomic-embed-text-v1 (~270MB) with stderr progress. Cached to
  ~/.cache/huggingface/ thereafter.
- DB auto-created at ~/.global-agent-memory.db
- sqlite-vec load failure → exits with clear message

## Testing
- Vitest test runner
- Unit tests: scoring formula (pure functions)
- Integration tests: in-memory SQLite, all 5 tools
- Embedding: mocked Transformers.js pipeline in CI

## Packaging
- npm package: mtmem
- bin: npx mtmem (stdio), npx mtmem --http (HTTP/SSE)
- README with OpenCode, Copilot, Cursor config snippets
- MIT license
