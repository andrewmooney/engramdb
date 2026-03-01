
## Memory (engramdb)

You have persistent memory via the `engramdb` MCP server. A plugin handles the lifecycle
automatically (opening/closing conversations, loading prior context at session start).
Your job is to make judgment calls about what's worth storing.

### When to call `remember_memory`

Call it when you learn something worth carrying into future sessions:
- Architectural decisions ("We use WAL mode for SQLite in this project")
- User preferences ("The user prefers functional style over classes")
- Recurring patterns ("All imports use `.js` extension — ESM TypeScript convention")
- Gotchas / debugging findings ("sqlite-vec requires extension loading before vec0 queries")
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

The plugin appends assistant turns automatically. Call `append_turn(role="user", ...)`
manually if the user's message contains an important decision or constraint that you want
preserved in the conversation log.
