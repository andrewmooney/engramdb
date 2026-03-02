# Lazy Conversation Creation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the engramdb OpenCode plugin resilient to missing `session.created` events by lazily creating the conversation on the first `session.status` idle event.

**Architecture:** Extract a `getOrCreateConversation` helper that checks `conversationMap` first and calls `start_conversation` only if needed. Both `session.created` and `session.status` handlers call this helper instead of separate map-lookup/create code paths. The plugin source of truth lives in `src/setup.ts` (as `OPENCODE_PLUGIN_SOURCE`) and is deployed to `~/.config/opencode/plugins/engramdb.ts` via `node dist/index.js setup`.

**Tech Stack:** TypeScript, Bun, OpenCode plugin API, engramdb MCP server

---

### Task 1: Update `src/setup.ts` with the new plugin source

**Files:**
- Modify: `src/setup.ts`

The plugin source is stored as a template string in `src/setup.ts` as `OPENCODE_PLUGIN_SOURCE`. Update it to add the `getOrCreateConversation` helper and refactor both `session.created` and `session.status` to use it.

**Step 1: Open `src/setup.ts` and locate `OPENCODE_PLUGIN_SOURCE`**

Find the exported constant that contains the full plugin TypeScript source as a string.

**Step 2: Replace the plugin source string**

The new plugin source should be:

```typescript
import type { Plugin } from "@opencode-ai/plugin"
import { $ } from "bun"
import path from "path"

const conversationMap = new Map<string, string>()
const lastAppendedIndexMap = new Map<string, number>()
let rpcId = 0

async function callMtmem(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const request = {
    jsonrpc: "2.0",
    id: ++rpcId,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  }
  const json = JSON.stringify(request)
  const result = await $`engramdb`.stdin(json).json()
  return result
}

async function getOrCreateConversation(
  sessionId: string,
  projectId: string,
  agentId: string,
): Promise<string | null> {
  const existing = conversationMap.get(sessionId)
  if (existing) return existing

  const title = `OpenCode session ${new Date().toISOString()}`
  const convResult = await callMtmem("start_conversation", {
    project_id: projectId,
    agent_id: agentId,
    title,
  }) as { result?: { content?: Array<{ text?: string }> } }
  const text = convResult?.result?.content?.[0]?.text ?? "{}"
  const parsed = JSON.parse(text) as { id?: string }
  if (parsed.id) {
    conversationMap.set(sessionId, parsed.id)
    return parsed.id
  }
  return null
}

export const EngramdbPlugin: Plugin = async ({ client, directory }) => {
  const projectId = path.basename(directory)
  const agentId = "opencode"

  return {
    event: async ({ event }) => {
      try {
        if (event.type === "session.created") {
          const sessionId = (event.properties as { info?: { id?: string } })?.info?.id
          if (!sessionId) return
          const conversationId = await getOrCreateConversation(sessionId, projectId, agentId)
          await callMtmem("recall_memories", { project_id: projectId, query: "recent work, decisions, patterns", limit: 10 })
          await callMtmem("search_conversations", { project_id: projectId, query: "recent sessions", limit: 3 })
          await client.app.log({ body: { service: "engramdb-plugin", level: "info", message: "session.created: conversation opened", extra: { sessionId, conversationId } } })
        } else if (event.type === "session.status") {
          const props = event.properties as { sessionID?: string; status?: { type?: string } }
          if (props.status?.type !== "idle") return
          const sessionID = props.sessionID
          if (!sessionID) return
          const conversationId = await getOrCreateConversation(sessionID, projectId, agentId)
          if (!conversationId) return
          try {
            const messages = await client.session.messages({ path: { id: sessionID } })
            const all = messages.data ?? []
            const startIdx = lastAppendedIndexMap.get(sessionID) ?? 0
            const unsaved = all.slice(startIdx)
            let appended = 0
            for (const m of unsaved) {
              const role = m.info?.role
              if (role !== "user" && role !== "assistant") continue
              const content = (m.parts ?? []).filter((p) => p.type === "text").map((p) => (p as { text?: string }).text ?? "").join("\n").trim()
              if (!content) continue
              await callMtmem("append_turn", { conversation_id: conversationId, role, content })
              appended++
            }
            if (appended > 0) {
              await client.app.log({ body: { service: "engramdb-plugin", level: "debug", message: `session.status: ${appended} turn(s) appended`, extra: { sessionID, appended } } })
            }
            lastAppendedIndexMap.set(sessionID, startIdx + unsaved.length)
          } catch (err) {
            await client.app.log({ body: { service: "engramdb-plugin", level: "warn", message: "session.status: append_turn failed", extra: { error: String(err), sessionID } } })
          }
        } else if (event.type === "session.deleted") {
          const sessionId = (event.properties as { info?: { id?: string } })?.info?.id
          if (!sessionId) return
          const conversationId = conversationMap.get(sessionId)
          if (!conversationId) return
          try {
            const messages = await client.session.messages({ path: { id: sessionId } })
            const all = messages.data ?? []
            const summary = all.slice(-6).map((m) => {
              const role = m.info?.role ?? "unknown"
              const text = (m.parts ?? []).filter((p) => p.type === "text").map((p) => (p as { text?: string }).text ?? "").join(" ").slice(0, 200)
              return `${role}: ${text}`
            }).join("\n")
            await callMtmem("close_conversation", { conversation_id: conversationId, summary: summary || "Session ended." })
            conversationMap.delete(sessionId)
            lastAppendedIndexMap.delete(sessionId)
            await client.app.log({ body: { service: "engramdb-plugin", level: "info", message: "session.deleted: conversation closed", extra: { sessionId, conversationId } } })
          } catch (err) {
            await client.app.log({ body: { service: "engramdb-plugin", level: "warn", message: "session.deleted: close_conversation failed", extra: { error: String(err), sessionId } } })
            conversationMap.delete(sessionId)
            lastAppendedIndexMap.delete(sessionId)
          }
        } else if (event.type.startsWith("session.")) {
          await client.app.log({ body: { service: "engramdb-plugin", level: "debug", message: `event: ${event.type}`, extra: event.properties } })
        }
      } catch (err) {
        try {
          await client.app.log({ body: { service: "engramdb-plugin", level: "warn", message: "engramdb-plugin event handler error", extra: { event: event.type, error: String(err) } } })
        } catch { /* never throw */ }
      }
    },
  }
}
```

**Step 3: Build**

Run: `npm run build`
Expected: no errors

**Step 4: Commit**

```bash
git add src/setup.ts
git commit -m "feat: lazy conversation creation in OpenCode plugin"
```

---

### Task 2: Deploy the updated plugin

**Files:**
- Deploy: `~/.config/opencode/plugins/engramdb.ts`

**Step 1: Run setup command**

Run: `node dist/index.js setup`
Expected: plugin file written to `~/.config/opencode/plugins/engramdb.ts`

**Step 2: Verify the deployed plugin contains `getOrCreateConversation`**

Run: `grep -n "getOrCreateConversation" ~/.config/opencode/plugins/engramdb.ts`
Expected: lines showing the function definition and its call sites

**Step 3: Commit**

The deployed plugin file lives outside the repo — no commit needed. The source change in Task 1 is the canonical record.
