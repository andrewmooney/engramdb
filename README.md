# mtmem

**Persistent, semantically-searchable memory for AI coding agents.**

AI coding agents are stateless by default — every new session starts from scratch. `mtmem` gives your agents a long-term memory store they can read from and write to across projects, sessions, and tools. Agents can remember architectural decisions, learned preferences, recurring patterns, debugging notes, and anything else worth carrying forward. Memories are retrieved by semantic similarity, not keyword matching, so agents find relevant context even when the exact wording differs.

`mtmem` runs as an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server. Any MCP-compatible client — OpenCode, Claude Desktop, Cursor, GitHub Copilot — can connect to it and use its five tools to read and write memories.

---

## How it works

When an agent stores a memory, `mtmem` generates a 768-dimensional embedding vector using [`nomic-embed-text-v1`](https://huggingface.co/nomic-ai/nomic-embed-text-v1) and persists both the text and the vector to a local SQLite database (`~/.global-agent-memory.db` by default). The database is shared across all projects and all agents on your machine.

When an agent retrieves memories, `mtmem` embeds the query and performs a nearest-neighbour search using `sqlite-vec`. Results are ranked by a weighted score:

```
score = 0.6 × cosine_similarity + 0.25 × importance + 0.15 × recency_decay
```

`recency_decay` is `exp(-0.01 × days_since_last_access)`, so recently-accessed memories rank higher. All weights and the decay rate are configurable via environment variables.

Memories are scoped to a `project_id` (usually a repository name or path). The `recall_memories` tool searches within a project; `search_global` searches across all projects.

---

## Installation

```bash
npm install -g mtmem
```

> **Requirements:** Node.js ≥ 20. The first time you start `mtmem`, it will download the embedding model (~270 MB) from Hugging Face. Subsequent starts are fast.

---

## Quick start

Start the server in stdio mode (the default, used by most MCP clients):

```bash
mtmem
```

You should see:

```
[mtmem] Loading embedding model (first run may take a moment)...
[mtmem] Embedding model ready.
[mtmem] MCP server running on stdio
```

---

## Setup

Run `mtmem setup` to automatically configure your AI client(s). Setup detects which clients are installed and writes the appropriate agent instruction files.

```bash
mtmem setup
```

**What it does per client:**

| Client | Action |
|---|---|
| OpenCode | Installs the session lifecycle plugin + writes `~/.config/opencode/AGENTS.md` |
| Claude Code | Appends memory instructions to `~/.claude/CLAUDE.md` |
| Cursor | Writes `~/.cursor/rules/mtmem.md` |
| VS Code Copilot | Writes `.github/copilot-instructions.md` in the current directory |
| Claude Desktop | Detected but not configured — no global instruction file path |

Setup is idempotent — safe to re-run after upgrading mtmem (the OpenCode plugin is always updated; instruction files are never duplicated).

---

## Client configuration

### OpenCode

Add to `~/.config/opencode/config.json`:

```json
{
  "mcp": {
    "mtmem": {
      "type": "local",
      "command": ["mtmem"]
    }
  }
}
```

### Claude Code

Run once in your terminal (adds to user scope, available across all projects):

```bash
claude mcp add --transport stdio --scope user mtmem -- mtmem
```

Or for project scope only (shared via `.mcp.json`):

```bash
claude mcp add --transport stdio --scope project mtmem -- mtmem
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "mtmem": {
      "command": "mtmem",
      "args": []
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your home directory or project root:

```json
{
  "mcpServers": {
    "mtmem": {
      "command": "mtmem",
      "args": []
    }
  }
}
```

### GitHub Copilot (VS Code)

Add to `.vscode/mcp.json` in your project, or to your VS Code user settings:

```json
{
  "servers": {
    "mtmem": {
      "type": "stdio",
      "command": "mtmem",
      "args": []
    }
  }
}
```

---

## Available tools

### `remember_memory`

Store a new memory for the current project. Call this when the agent learns something worth keeping — a decision, a pattern, a user preference, a gotcha.

**Inputs:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `project_id` | string | yes | Identifier for the project (e.g. `"my-app"` or a repo path) |
| `content` | string | yes | The memory text to store |
| `agent_id` | string | yes | Identifier for the agent storing the memory |
| `type` | string | no | One of `fact`, `preference`, `pattern`, `decision`, `bug_fix` (default: `fact`) |
| `importance` | number | no | Score from 0.0 to 1.0 indicating how important this memory is (default: `0.5`) |

**Example response:**

```json
{
  "id": "b3f2a1c4-...",
  "message": "Memory stored successfully."
}
```

---

### `recall_memories`

Search for memories within a specific project. Use this at the start of a session to reload relevant context about the project you're working on.

**Inputs:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `project_id` | string | yes | The project to search within |
| `query` | string | yes | Natural language query describing what you're looking for |
| `limit` | number | no | Maximum results to return (default: `10`, max: `50`) |

**Example response:**

```json
[
  {
    "id": "b3f2a1c4-...",
    "content": "Always use WAL mode for SQLite in this project — it avoids lock contention during tests.",
    "type": "decision",
    "importance": 0.9,
    "score": 0.87,
    "project_id": "my-app",
    "agent_id": "claude",
    "created_at": 1740825600,
    "last_accessed_at": 1740825600
  }
]
```

---

### `search_global`

Search for memories across all projects. Useful when you want to reuse patterns or preferences that were learned in a different project.

**Inputs:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | Natural language query |
| `limit` | number | no | Maximum results to return (default: `10`, max: `50`) |

Returns the same shape as `recall_memories`, with `project_id` populated so you know where each memory came from.

---

### `update_memory`

Update the content, importance, or type of an existing memory. If you update the content, the embedding is automatically regenerated.

**Inputs:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | The memory ID to update |
| `content` | string | no | New content text (triggers re-embedding) |
| `importance` | number | no | New importance score (0.0–1.0) |
| `type` | string | no | New memory type |

**Example response:**

```json
{
  "message": "Memory updated successfully."
}
```

---

### `list_projects`

List all projects that have at least one stored memory, along with a count of memories per project.

**Inputs:** none

**Example response:**

```json
[
  { "project_id": "my-app", "count": 14 },
  { "project_id": "other-project", "count": 3 }
]
```

---

## Conversation tools

These tools let agents store and search the conversational context of a session. Raw turns are stored during a session, and a compressed summary is embedded and made searchable when the conversation is closed.

### `start_conversation`

Start a new conversation session. Returns a conversation ID to use with subsequent `append_turn` and `close_conversation` calls.

**Inputs:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `project_id` | string | yes | Project this conversation belongs to |
| `agent_id` | string | yes | Identifier for the agent |
| `title` | string | no | Optional short label for the conversation |

**Example response:**

```json
{
  "id": "b3f2a1c4-...",
  "created_at": 1740825600000
}
```

---

### `append_turn`

Append a message turn to an open conversation. Errors if the conversation is closed or does not exist.

**Inputs:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `conversation_id` | string | yes | Target conversation |
| `role` | string | yes | `user`, `assistant`, or `tool` |
| `content` | string | yes | Turn content |

**Example response:**

```json
{
  "turn_id": "c4a1f3b2-...",
  "turn_index": 3
}
```

---

### `close_conversation`

Close a conversation. Stores the agent-written summary, embeds it, and makes the conversation searchable via `search_conversations`. Errors if the conversation is already closed.

**Inputs:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `conversation_id` | string | yes | Target conversation |
| `summary` | string | yes | Agent-written summary of the session |

**Example response:**

```json
{
  "message": "Conversation closed."
}
```

---

### `get_conversation`

Retrieve a conversation's metadata and all its turns in order. Works for both open and closed conversations.

**Inputs:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `conversation_id` | string | yes | Target conversation |

**Example response:**

```json
{
  "conversation": {
    "id": "b3f2a1c4-...",
    "project_id": "my-app",
    "agent_id": "claude",
    "title": "Feature design session",
    "summary": null,
    "status": "open",
    "turn_count": 4,
    "created_at": 1740825600000,
    "updated_at": 1740825700000,
    "closed_at": null
  },
  "turns": [
    { "id": "...", "conversation_id": "...", "role": "user", "content": "How should we...", "turn_index": 0, "created_at": 1740825600000 },
    { "id": "...", "conversation_id": "...", "role": "assistant", "content": "I'd suggest...", "turn_index": 1, "created_at": 1740825650000 }
  ]
}
```

---

### `search_conversations`

Semantically search closed conversations by their summaries. Omit `project_id` to search across all projects. Uses the same weighted scoring as `recall_memories`.

**Inputs:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | Natural language search query |
| `project_id` | string | no | Restrict to a single project; omit for global search |
| `limit` | number | no | Maximum results to return (default: `10`, max: `50`) |

**Example response:**

```json
[
  {
    "id": "b3f2a1c4-...",
    "project_id": "my-app",
    "agent_id": "claude",
    "title": "Feature design session",
    "summary": "We decided to use a plugin architecture for extensibility...",
    "status": "closed",
    "turn_count": 12,
    "score": 0.84,
    "created_at": 1740825600000,
    "updated_at": 1740826200000,
    "closed_at": 1740826200000
  }
]
```

---

## Configuration

All configuration is done via environment variables. You can set these in your shell profile or pass them inline when starting `mtmem`.

| Variable | Default | Description |
|---|---|---|
| `MTMEM_DB_PATH` | `~/.global-agent-memory.db` | Path to the SQLite database file. Useful if you want to isolate memories per machine or project. |
| `MCP_TRANSPORT` | `stdio` | Set to `http` to start the server in HTTP/SSE mode instead of stdio. |
| `MCP_PORT` | `3456` | Port to listen on when using HTTP mode. |
| `MTMEM_W_SIM` | `0.6` | Weight given to cosine similarity in the ranking score. |
| `MTMEM_W_IMP` | `0.25` | Weight given to memory importance in the ranking score. |
| `MTMEM_W_REC` | `0.15` | Weight given to recency decay in the ranking score. |
| `MTMEM_DECAY_LAMBDA` | `0.01` | Decay rate for recency. Higher values cause older memories to fall in rank faster. |

The three scoring weights (`MTMEM_W_SIM`, `MTMEM_W_IMP`, `MTMEM_W_REC`) should sum to 1.0 for predictable score ranges, but this is not enforced.

---

## HTTP/SSE transport

By default `mtmem` communicates over stdio, which is the right choice for local desktop clients. If you want to run `mtmem` as a shared service on a server (for example, to share a memory store across multiple machines or containers), you can switch to HTTP/SSE transport.

Start the server in HTTP mode:

```bash
MCP_TRANSPORT=http mtmem
# or
mtmem --http
```

Output:

```
[mtmem] MCP server listening on http://localhost:3456/sse
```

You can then connect any MCP client that supports SSE transport to `http://localhost:3456/sse`.

To verify the server is running, you can send a raw SSE request:

```bash
curl -N http://localhost:3456/sse
```

You should see the SSE stream open and stay connected. MCP messages are sent as `data:` events on this stream.

---

## Development

```bash
git clone https://github.com/your-org/mtmem.git
cd mtmem
npm install
```

Run the tests:

```bash
npm test
```

Build:

```bash
npm run build
```

The compiled output lands in `dist/`. The entry point is `dist/index.js`.

To run directly from source during development:

```bash
node --loader ts-node/esm src/index.ts
```

Or link it globally so you can use the `mtmem` command against your local build:

```bash
npm run build && npm link
```

---

## License

MIT
