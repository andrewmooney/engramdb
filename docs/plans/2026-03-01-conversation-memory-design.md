# Design: Conversation Memory

**Date:** 2026-03-01
**Status:** Approved

---

## Problem

The existing `memories` table stores discrete, atomic facts. It has no concept of conversational context — the back-and-forth exchange between a user and an agent during a session. Without this, agents cannot resume a prior session or search past conversations for relevant prior decisions.

---

## Goals

- Store raw conversation turns (user / assistant / tool) during a session.
- Compress a completed conversation into a semantic summary on close.
- Allow agents to resume a session by replaying raw turns.
- Allow agents to search past conversations by semantic similarity.
- Conversations are scoped to a `project_id` and searchable globally, consistent with the existing memory model.

---

## Approach: First-class conversation tables (Approach A)

Two new tables are added to the existing `~/.global-agent-memory.db`. Turns are stored without embeddings (cheap). A summary is embedded only when the conversation is closed (one embedding per conversation). Semantic search operates on summaries only.

---

## Schema

```sql
CREATE TABLE conversations (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  title       TEXT,
  summary     TEXT,
  status      TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'closed'
  turn_count  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  closed_at   INTEGER
);

CREATE TABLE conversation_turns (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role            TEXT NOT NULL,   -- 'user' | 'assistant' | 'tool'
  content         TEXT NOT NULL,
  turn_index      INTEGER NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE TABLE conversation_embeddings (
  id        TEXT PRIMARY KEY REFERENCES conversations(id),
  embedding BLOB NOT NULL   -- vec(768), indexed with sqlite-vec
);
```

`conversation_embeddings` is populated only when a conversation is closed. Open conversations are not searchable by vector.

---

## MCP Tools

### `start_conversation`

Creates a new open conversation.

**Inputs:**

| Parameter    | Type   | Required | Description                              |
|---|---|---|---|
| `project_id` | string | yes      | Project this conversation belongs to     |
| `agent_id`   | string | yes      | Identifier for the agent                 |
| `title`      | string | no       | Optional short label for the conversation |

**Response:** `{ id, created_at }`

---

### `append_turn`

Appends a turn to an open conversation. Errors if the conversation is closed or not found.

**Inputs:**

| Parameter         | Type   | Required | Description                               |
|---|---|---|---|
| `conversation_id` | string | yes      | Target conversation                       |
| `role`            | string | yes      | `user`, `assistant`, or `tool`            |
| `content`         | string | yes      | Turn content                              |

**Response:** `{ turn_id, turn_index }`

---

### `close_conversation`

Closes a conversation, stores the summary, embeds it, and inserts the embedding. The conversation transitions to `status: 'closed'`. Errors if already closed. The embedding write is transactional — if embedding fails, the conversation remains open.

**Inputs:**

| Parameter         | Type   | Required | Description                          |
|---|---|---|---|
| `conversation_id` | string | yes      | Target conversation                  |
| `summary`         | string | yes      | Agent-written summary of the session |

**Response:** `{ message: "Conversation closed." }`

---

### `get_conversation`

Returns conversation metadata and all turns in `turn_index` order. No vector search.

**Inputs:**

| Parameter         | Type   | Required | Description         |
|---|---|---|---|
| `conversation_id` | string | yes      | Target conversation |

**Response:** `{ conversation: ConversationRow, turns: TurnRow[] }`

---

### `search_conversations`

Semantic search over closed conversation summaries. Uses the same WLC scoring formula as `recall_memories`:

```
score = 0.6 × cosine_similarity + 0.25 × importance + 0.15 × recency_decay
```

Importance is fixed at `0.5` for conversations (no user-supplied importance). Open conversations are excluded (no embedding).

**Inputs:**

| Parameter    | Type   | Required | Description                                        |
|---|---|---|---|
| `query`      | string | yes      | Natural language search query                      |
| `project_id` | string | no       | Restrict to a single project; omit for global search |
| `limit`      | number | no       | Max results (default 10, max 50)                   |

**Response:** Array of `{ id, project_id, agent_id, title, summary, score, closed_at, turn_count }`

---

## Data Flow

### Storing

```
start_conversation → conversation_id
  ↓ (per message)
append_turn(conversation_id, role, content)
  ↓ (session ends)
close_conversation(conversation_id, summary)
  → embed(summary) → insert conversation_embeddings
```

### Retrieving

```
get_conversation(id) → metadata + raw turns (ordered)
search_conversations(query, project_id?) → embed(query) → ANN search → re-rank → summaries
```

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| `append_turn` on closed conversation | Error: "Conversation is closed" |
| `close_conversation` on already-closed conversation | Error: "Conversation already closed" |
| `get_conversation` with unknown ID | Error: "Conversation not found" |
| Embedding failure during `close_conversation` | Transaction rolled back; conversation stays open |

---

## Testing

- Unit tests for `src/conversation.ts`: `insertConversation`, `appendTurn`, `closeConversation`, `queryConversations`, `getConversation`.
- Tool handler tests for all 5 new tools.
- Mirrors the existing `memory.ts` / tool test pattern.

---

## Out of scope

- Auto-summarization on turn count threshold (can be added later).
- Lazy summarization on first search.
- Per-turn embeddings.
- Deleting conversations.
