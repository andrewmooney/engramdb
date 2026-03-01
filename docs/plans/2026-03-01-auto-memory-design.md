# Design: Automatic Memory & Conversation Capture

**Date:** 2026-03-01  
**Status:** Approved

---

## Goal

Ensure that mtmem tools are called automatically during every OpenCode session — without requiring the agent to remember to do so. The agent should still exercise judgment on *what* to store as a memory, but lifecycle operations (opening/closing conversations, loading prior context) must not depend on the agent's initiative.

---

## Approach

**Approach C — Both plugin hooks and AGENTS.md rules.**

- **OpenCode plugin** (`~/.config/opencode/plugins/mtmem.ts`): Handles guaranteed lifecycle operations at session boundaries.
- **AGENTS.md** (`~/.config/opencode/AGENTS.md`): Handles judgment calls during the session (when to call `remember_memory`, what type and importance to assign).

---

## Components

### 1. Plugin: `~/.config/opencode/plugins/mtmem.ts`

A global OpenCode plugin that fires automatically on session lifecycle events.

#### `session.created`
- Call `start_conversation(project_id, agent_id="opencode", title)` — opens a new conversation record in mtmem.
- Call `recall_memories(project_id, query)` — loads top-10 relevant memories for this project.
- Call `search_conversations(project_id, query)` — surfaces the 3 most recent closed conversations for context.
- `project_id` is derived from `path.basename(directory)`.
- `title` is the first user message if available, otherwise a timestamp-based placeholder.
- Results are injected into the session via `tui.prompt.append` or logged for the agent to reference.

#### `session.idle`
- Fires after each assistant response.
- Calls `append_turn(conversation_id, role="assistant", content=last_message)` to keep the conversation log current.

#### `session.deleted`
- Fires when the session ends.
- Calls `close_conversation(conversation_id, summary)` to compress the conversation into a searchable embedding.
- Summary is derived from the session content (last assistant message, or a brief description of what was accomplished).

#### Error handling
- All MCP calls are wrapped in try/catch.
- Failures are logged via `client.app.log()` at `warn` level.
- No failure ever throws — a mtmem outage must never break the agent.

#### `conversation_id` persistence
- Stored in a plugin-local `Map<sessionId, conversationId>` for the lifetime of the OpenCode process.
- A new OpenCode launch always starts fresh, which is correct behaviour.

#### MCP invocation strategy
- Prefer invoking mtmem tools via the OpenCode `client` SDK if it exposes MCP tool calls.
- Fallback: invoke via Bun shell (`$`) with a JSON-RPC stdio call to the `mtmem` binary.

---

### 2. AGENTS.md: `~/.config/opencode/AGENTS.md`

Global agent instructions that apply across all OpenCode sessions.

#### What to instruct

**Memory storage (`remember_memory`):**
- Call `remember_memory` when you learn something worth keeping: architectural decisions, user preferences, recurring patterns, gotchas, debugging findings.
- Set `importance` based on how broadly applicable the fact is:
  - `0.9` — project-wide conventions, architectural constraints
  - `0.7` — common patterns, repeated preferences
  - `0.5` — session-specific notes, one-off observations
- Use the appropriate `type`: `decision`, `preference`, `code_pattern`, `fact`, `observation`.
- Do NOT store: transient state, things already in the codebase, things that will be outdated immediately.

**Turn logging (`append_turn`):**
- The plugin handles assistant turns automatically via `session.idle`.
- The agent should call `append_turn(role="user", ...)` for significant user messages that contain important context or decisions.

**Context at session start:**
- The plugin loads prior memories and conversations automatically.
- The agent should read and acknowledge this context before starting work.

---

## Data Flow

```
Session starts
  └── plugin: session.created
        ├── mtmem: start_conversation(project_id, agent_id, title)  → stores conversation_id
        ├── mtmem: recall_memories(project_id, query)               → injects prior memories
        └── mtmem: search_conversations(project_id, query)          → injects recent conversations

Agent works...
  └── plugin: session.idle (after each assistant response)
        └── mtmem: append_turn(conversation_id, "assistant", content)

Agent stores a memory (judgment call, driven by AGENTS.md)
  └── agent: remember_memory(project_id, content, type, importance)

Session ends
  └── plugin: session.deleted
        └── mtmem: close_conversation(conversation_id, summary)
```

---

## Files to Create / Modify

| File | Action | Purpose |
|------|--------|---------|
| `~/.config/opencode/plugins/mtmem.ts` | Create | Lifecycle plugin |
| `~/.config/opencode/AGENTS.md` | Create or append | Agent instructions |

Neither file lives in the mtmem repository — they are user-level OpenCode configuration.

---

## Open Questions

1. Does the OpenCode plugin `client` object expose a method to invoke MCP tools programmatically? If not, the plugin falls back to `$` (Bun shell + JSON-RPC).
2. Does `session.created` fire before or after the first user message is available? Affects whether `title` can be derived from the message.
3. What is the exact shape of the `session.idle` event payload — does it include the last message content?

These will be resolved during implementation by inspecting the OpenCode plugin SDK types.
