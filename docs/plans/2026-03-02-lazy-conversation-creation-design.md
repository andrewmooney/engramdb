# Design: Lazy Conversation Creation

**Date:** 2026-03-02

## Problem

The OpenCode plugin creates a conversation in `session.created` and stores the ID in an in-memory `conversationMap`. If `session.created` never fires, or the process is killed before idle events can use the map, turns are lost because `session.status` (idle) only appends if the conversation ID is already in the map.

## Goal

Ensure conversation turns are persisted even when:
- The process is force-quit (SIGKILL) between `session.created` and the first idle event
- OpenCode is closed normally without an explicit session deletion

## Approach: Lazy `getOrCreateConversation`

Extract a `getOrCreateConversation(sessionId)` helper that returns a conversation ID from the map if present, or calls `start_conversation` and stores the result if not. Both `session.created` and `session.status` (idle) call this helper.

## Design

### New helper

```typescript
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
```

### `session.created`

- Calls `getOrCreateConversation` (pre-warms the map as before)
- Still loads recent memories and conversations into context
- No behavioral change when this event fires normally

### `session.status` (idle)

- Calls `getOrCreateConversation` instead of a plain map lookup
- If `session.created` never fired, the conversation is created here on the first idle
- Appends turns as before

### `session.deleted`

- No change — closes the conversation with a summary when triggered

## Data Flow

```
session.created  →  getOrCreateConversation  →  conversationMap populated
                                              ↓
session.status   →  getOrCreateConversation  →  already in map OR create now
                                              ↓
                    append turns since watermark
                                              ↓
session.deleted  →  close_conversation with summary
```

## Error Handling

No change from current approach — errors are caught and logged, the plugin never throws.

## Testing

Manual verification:
1. Start a session, send a message, kill the process (SIGKILL), restart — confirm the conversation and turn exist in engramdb
2. Start a session, send messages, close the app normally — confirm turns are persisted
3. Explicitly delete a session — confirm `close_conversation` still fires and the conversation is closed with a summary
