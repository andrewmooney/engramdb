# Automatic Memory & Conversation Capture — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically call mtmem MCP tools at OpenCode session lifecycle points, so agents never need to remember to open/close conversations or load prior context.

**Architecture:** An OpenCode global plugin fires on `session.created`, `session.idle`, and `session.deleted` events to call mtmem tools via Bun shell JSON-RPC. A global `AGENTS.md` instructs the agent on judgment calls (when to store a memory, what importance to assign).

**Tech Stack:** TypeScript plugin (`@opencode-ai/plugin`), Bun shell (`$`), JSON-RPC stdio to `mtmem` binary, OpenCode `AGENTS.md` rules.

---

## Context

### Files to create
- `~/.config/opencode/plugins/mtmem.ts` — global OpenCode plugin
- `~/.config/opencode/AGENTS.md` — global agent instructions (create if absent, append if present)

### How mtmem tools are called from a plugin

The OpenCode plugin `client` SDK does **not** expose MCP tool calls directly. Instead, call `mtmem` via Bun shell:

```ts
const result = await $`echo ${JSON.stringify(request)} | mtmem`.json()
```

Where `request` is a JSON-RPC 2.0 `tools/call` message:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "remember_memory",
    "arguments": { "project_id": "myproject", "content": "...", "agent_id": "opencode" }
  }
}
```

> **Note:** mtmem runs in stdio mode. The shell pipe sends one request and reads one response. This is synchronous per call. If mtmem is not installed/on PATH, the call fails silently (logged, not thrown).

### How `project_id` is derived

```ts
import path from "path"
const projectId = path.basename(directory)
```

`directory` is provided to the plugin function as a parameter.

### How `conversation_id` is persisted

```ts
const conversationMap = new Map<string, string>() // sessionId -> conversationId
```

This lives in plugin module scope. It survives for the lifetime of the OpenCode process.

### Plugin event payload shapes

- `session.created` event has `{ sessionId: string }` in its properties — use this as the map key.
- `session.idle` event has `{ sessionId: string }` — look up `conversationId` from map.
- `session.deleted` event has `{ sessionId: string }` — look up `conversationId`, call `close_conversation`, delete from map.

Use `client.event.subscribe()` or the plugin hook pattern `event: async ({ event }) => { ... }` to listen.

> **Verify payload shapes** at runtime — log them on first run to confirm field names.

---

## Task 1: Scaffold the plugin file

**Files:**
- Create: `~/.config/opencode/plugins/mtmem.ts`

**Step 1: Verify the plugins directory exists**

```bash
ls ~/.config/opencode/plugins/
```

If it doesn't exist:
```bash
mkdir -p ~/.config/opencode/plugins/
```

**Step 2: Check if a `package.json` exists in `~/.config/opencode/`**

```bash
cat ~/.config/opencode/package.json
```

If it doesn't exist, create it (needed for `@opencode-ai/plugin` types):

```json
{
  "dependencies": {
    "@opencode-ai/plugin": "latest"
  }
}
```

**Step 3: Write the plugin scaffold**

```ts
import type { Plugin } from "@opencode-ai/plugin"
import path from "path"

// In-memory map: OpenCode sessionId -> mtmem conversationId
const conversationMap = new Map<string, string>()

async function callMtmem(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  }
  // Bun shell: pipe JSON-RPC request to mtmem stdio
  const { $ } = await import("bun")
  const json = JSON.stringify(request)
  const result = await $`echo ${json} | mtmem`.json()
  return result
}

export const MtmemPlugin: Plugin = async ({ client, directory }) => {
  const projectId = path.basename(directory)
  const agentId = "opencode"

  return {
    event: async ({ event }) => {
      // Log all events on first load to verify payload shapes
      if (event.type.startsWith("session.")) {
        await client.app.log({
          body: { service: "mtmem-plugin", level: "debug", message: `event: ${event.type}`, extra: event.properties },
        })
      }
    },
  }
}
```

**Step 4: Verify OpenCode picks up the plugin**

Start OpenCode in a project. Check logs or console for the `mtmem-plugin` debug log line.

No commit needed — this file lives outside the mtmem repo.

---

## Task 2: Implement `session.created` — open conversation + load context

**Files:**
- Modify: `~/.config/opencode/plugins/mtmem.ts`

**Step 1: Update the event handler to handle `session.created`**

Replace the scaffold event handler with:

```ts
event: async ({ event }) => {
  if (event.type === "session.created") {
    const sessionId = event.properties?.sessionId as string | undefined
    if (!sessionId) return

    try {
      // 1. Open a new conversation
      const title = `OpenCode session ${new Date().toISOString()}`
      const convResult = await callMtmem("start_conversation", {
        project_id: projectId,
        agent_id: agentId,
        title,
      }) as { result?: { content?: Array<{ text?: string }> } }

      // Parse conversation_id from the response text (JSON embedded in content[0].text)
      const text = convResult?.result?.content?.[0]?.text ?? "{}"
      const parsed = JSON.parse(text) as { id?: string }
      if (parsed.id) {
        conversationMap.set(sessionId, parsed.id)
      }

      // 2. Load prior memories
      await callMtmem("recall_memories", {
        project_id: projectId,
        query: "recent work, decisions, patterns",
        limit: 10,
      })

      // 3. Load recent conversations
      await callMtmem("search_conversations", {
        project_id: projectId,
        query: "recent sessions",
        limit: 3,
      })

      await client.app.log({
        body: { service: "mtmem-plugin", level: "info", message: "session.created: conversation opened", extra: { sessionId, conversationId: parsed.id } },
      })
    } catch (err) {
      await client.app.log({
        body: { service: "mtmem-plugin", level: "warn", message: "session.created failed", extra: { error: String(err) } },
      })
    }
  }
},
```

**Step 2: Verify by starting a new OpenCode session**

Check the OpenCode logs for:
- `session.created: conversation opened`
- No thrown errors

Also verify in the mtmem DB that a new row appears in `conversations`:

```bash
sqlite3 ~/.global-agent-memory.db "SELECT id, title, status FROM conversations ORDER BY created_at DESC LIMIT 3;"
```

---

## Task 3: Implement `session.idle` — append assistant turn

**Files:**
- Modify: `~/.config/opencode/plugins/mtmem.ts`

**Step 1: Add `session.idle` handling inside the event handler**

Add an `else if` branch after the `session.created` block:

```ts
} else if (event.type === "session.idle") {
  const sessionId = event.properties?.sessionId as string | undefined
  if (!sessionId) return

  const conversationId = conversationMap.get(sessionId)
  if (!conversationId) return

  try {
    // Fetch the last assistant message from the session
    const messages = await client.session.messages({ path: { id: sessionId } })
    const all = messages.data ?? []
    // Find the last assistant message
    const lastAssistant = [...all].reverse().find(
      (m) => m.info?.role === "assistant"
    )
    if (!lastAssistant) return

    // Extract text content from parts
    const content = (lastAssistant.parts ?? [])
      .filter((p) => p.type === "text")
      .map((p) => (p as { text?: string }).text ?? "")
      .join("\n")
      .trim()
    if (!content) return

    await callMtmem("append_turn", {
      conversation_id: conversationId,
      role: "assistant",
      content,
    })
  } catch (err) {
    await client.app.log({
      body: { service: "mtmem-plugin", level: "warn", message: "session.idle append_turn failed", extra: { error: String(err) } },
    })
  }
```

**Step 2: Verify**

After an assistant response, check the `conversation_turns` table:

```bash
sqlite3 ~/.global-agent-memory.db "SELECT role, substr(content, 1, 80) FROM conversation_turns ORDER BY created_at DESC LIMIT 3;"
```

---

## Task 4: Implement `session.deleted` — close conversation

**Files:**
- Modify: `~/.config/opencode/plugins/mtmem.ts`

**Step 1: Add `session.deleted` handling**

Add an `else if` branch:

```ts
} else if (event.type === "session.deleted") {
  const sessionId = event.properties?.sessionId as string | undefined
  if (!sessionId) return

  const conversationId = conversationMap.get(sessionId)
  if (!conversationId) return

  try {
    // Build a summary from the last few messages
    const messages = await client.session.messages({ path: { id: sessionId } })
    const all = messages.data ?? []
    const summary = all
      .slice(-6)
      .map((m) => {
        const role = m.info?.role ?? "unknown"
        const text = (m.parts ?? [])
          .filter((p) => p.type === "text")
          .map((p) => (p as { text?: string }).text ?? "")
          .join(" ")
          .slice(0, 200)
        return `${role}: ${text}`
      })
      .join("\n")

    await callMtmem("close_conversation", {
      conversation_id: conversationId,
      summary: summary || "Session ended.",
    })

    conversationMap.delete(sessionId)
  } catch (err) {
    await client.app.log({
      body: { service: "mtmem-plugin", level: "warn", message: "session.deleted close_conversation failed", extra: { error: String(err) } },
    })
  }
```

**Step 2: Verify**

Delete a session in OpenCode. Check that the conversation status flips to `closed`:

```bash
sqlite3 ~/.global-agent-memory.db "SELECT id, status, substr(summary, 1, 100) FROM conversations ORDER BY updated_at DESC LIMIT 3;"
```

---

## Task 5: Write the global AGENTS.md

**Files:**
- Create or append: `~/.config/opencode/AGENTS.md`

**Step 1: Check if the file already exists**

```bash
cat ~/.config/opencode/AGENTS.md
```

**Step 2: If it does not exist, create it. If it does, append the mtmem section.**

Add the following section (create the file if needed, otherwise append below existing content):

```markdown
## Memory (mtmem)

You have persistent memory via the `mtmem` MCP server. A plugin handles the lifecycle automatically (opening/closing conversations, loading prior context at session start). Your job is to make judgment calls about what's worth storing.

### When to call `remember_memory`

Call it when you learn something worth carrying into future sessions:
- Architectural decisions ("We use WAL mode for SQLite in this project")
- User preferences ("The user prefers functional style over classes")
- Recurring patterns ("All imports use `.js` extension — ESM TypeScript convention")
- Gotchas / debugging findings ("sqlite-vec requires the extension to be loaded before any vec0 queries")
- Project constraints ("Node.js >= 20 required; no CommonJS")

Do NOT store: transient state, things already visible in the codebase, things that will be outdated immediately.

### `importance` guide

| Value | Use when |
|-------|----------|
| `0.9` | Project-wide conventions, hard constraints |
| `0.7` | Common patterns, repeated preferences |
| `0.5` | Session-specific notes, one-off observations |

### `type` guide

| Type | Use for |
|------|---------|
| `decision` | Architectural or design choices |
| `preference` | User style or workflow preferences |
| `code_pattern` | Recurring code patterns or conventions |
| `fact` | General facts about the project |
| `observation` | Things you noticed that may be useful later |

### When to call `append_turn` manually

The plugin appends assistant turns automatically. Call `append_turn(role="user", ...)` manually if the user's message contains an important decision or constraint that you want preserved in the conversation log.
```

**Step 3: Verify the file looks correct**

```bash
cat ~/.config/opencode/AGENTS.md
```

---

## Task 6: Smoke test end-to-end

**Step 1: Start a fresh OpenCode session in any project directory**

Check that:
- OpenCode logs show `session.created: conversation opened`
- A new row appears in `conversations` with `status = 'open'`

```bash
sqlite3 ~/.global-agent-memory.db "SELECT id, project_id, status FROM conversations ORDER BY created_at DESC LIMIT 1;"
```

**Step 2: Send a few messages, ask the agent to store a memory**

Prompt: "Remember that this project uses ESM TypeScript with `.js` import extensions."

Check that `remember_memory` was called and a row appears in `memories`:

```bash
sqlite3 ~/.global-agent-memory.db "SELECT content, type FROM memories ORDER BY created_at DESC LIMIT 3;"
```

**Step 3: Check that turns are being appended after each assistant response**

```bash
sqlite3 ~/.global-agent-memory.db "SELECT role, substr(content, 1, 80) FROM conversation_turns ORDER BY created_at DESC LIMIT 5;"
```

**Step 4: Delete the session in OpenCode**

Check that the conversation flips to `closed`:

```bash
sqlite3 ~/.global-agent-memory.db "SELECT status, substr(summary, 1, 100) FROM conversations ORDER BY updated_at DESC LIMIT 1;"
```

**Step 5: Start a new session in the same project**

Verify that OpenCode loads the prior memories and closed conversation at session start (check logs).

---

## Notes

- The plugin lives at `~/.config/opencode/plugins/mtmem.ts` — it is **not** part of the mtmem repo.
- The `AGENTS.md` is also global user config — **not** committed to the mtmem repo.
- If `mtmem` is not on PATH, all plugin calls fail silently (logged at `warn`). The agent still works normally.
- The `callMtmem` helper imports `bun` dynamically — it only works inside an OpenCode plugin context where Bun is the runtime. Do not call it from Node.js tests.
- Event payload field names (`event.properties.sessionId`) should be verified on first run by logging raw event shapes. Adjust field names if needed.
