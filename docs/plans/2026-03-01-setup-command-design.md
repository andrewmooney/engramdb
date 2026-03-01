# `mtmem setup` — Design

**Goal:** A non-interactive `mtmem setup` subcommand that detects installed AI clients and writes the appropriate agent instruction files (and, for OpenCode, the lifecycle plugin) so users get persistent memory with zero manual configuration.

---

## Invocation

```bash
npx mtmem setup       # before install
mtmem setup           # after npm install -g mtmem
```

Running `mtmem setup` from any directory is valid. The current working directory is only relevant for VS Code Copilot (project-level `.github/copilot-instructions.md`).

---

## Architecture

`src/index.ts` gains a three-line guard at the very top of the file:

```ts
if (process.argv[2] === 'setup') {
  const { runSetup } = await import('./setup.js')
  await runSetup(); process.exit(0)
}
```

This dispatches before any DB or MCP server initialization, keeping the server path entirely unchanged.

All setup logic lives in `src/setup.ts`, exported as `runSetup()`.

---

## Client Detection & Actions

Setup iterates over a fixed list of client descriptors. Each descriptor specifies:
- How to detect the client (path existence check)
- What to write and where
- A human-readable label

### Client matrix

| Client | Detection path | Action | Scope |
|---|---|---|---|
| **OpenCode** | `~/.config/opencode/` exists | Install plugin + write AGENTS.md | Global |
| **Claude Code** | `~/.claude/` exists | Append to `~/.claude/CLAUDE.md` | Global |
| **Cursor** | `~/.cursor/` exists | Write `~/.cursor/rules/mtmem.md` | Global (best-effort) |
| **VS Code Copilot** | `~/.vscode/` exists | Write `.github/copilot-instructions.md` in cwd | Project |
| **Claude Desktop** | macOS: `~/Library/Application Support/Claude/` exists; Windows: `%APPDATA%\Claude\` exists | Detected but skipped — no instruction file path | — |

### OpenCode

1. `mkdir -p ~/.config/opencode/plugins/`
2. Write `~/.config/opencode/plugins/mtmem.ts` (plugin source embedded as a string constant in `setup.ts`) — overwrite always (idempotent, plugin is versioned with mtmem)
3. Ensure `~/.config/opencode/package.json` has `"@opencode-ai/plugin"` in dependencies — create file if absent, merge if present
4. Append mtmem section to `~/.config/opencode/AGENTS.md` — skip if the sentinel string `"## Memory (mtmem)"` is already present; create file if absent

### Claude Code

1. Append mtmem section to `~/.claude/CLAUDE.md` — skip if sentinel `"## Memory (mtmem)"` already present; create file if absent

### Cursor

1. `mkdir -p ~/.cursor/rules/`
2. Write `~/.cursor/rules/mtmem.md` — overwrite always (idempotent)

### VS Code Copilot

1. `mkdir -p .github/` in cwd
2. Append mtmem section to `.github/copilot-instructions.md` — skip if sentinel present; create if absent

### Claude Desktop

- Detected, reported in output as "detected but not configured (no instruction file path)"

---

## Idempotency

`mtmem setup` is safe to run multiple times:
- The OpenCode plugin is always overwritten (it's versioned alongside mtmem — newer runs should win)
- AGENTS.md / CLAUDE.md / copilot-instructions.md are appended only if the sentinel `## Memory (mtmem)` heading is not already present
- `package.json` dependency is merged (not replaced)
- Running setup again after an upgrade re-installs the plugin but does not duplicate instruction content

---

## Content written

### AGENTS.md section (used for OpenCode, Claude Code, VS Code Copilot)

```markdown
## Memory (mtmem)

You have persistent memory via the `mtmem` MCP server. A plugin handles the lifecycle
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
```

### Cursor rules file

`~/.cursor/rules/mtmem.md` — same content as the AGENTS.md section above.

### OpenCode plugin

`~/.config/opencode/plugins/mtmem.ts` — embedded verbatim in `setup.ts` as a template string constant `OPENCODE_PLUGIN_SOURCE`. Updated when mtmem is upgraded and setup is re-run.

---

## Output format

```
mtmem setup

Detected clients:
  ✓ OpenCode        plugin installed, AGENTS.md updated
  ✓ Claude Code     CLAUDE.md updated
  ✓ Cursor          rules file written (~/.cursor/rules/mtmem.md)
  ✓ VS Code Copilot .github/copilot-instructions.md updated
  - Claude Desktop  detected — no instruction file path (configure manually)
  - (not detected)  Claude Code, Cursor, VS Code Copilot

Setup complete. Restart your AI client to load the changes.
```

Lines prefixed `✓` = action taken. Lines prefixed `-` = skipped (not detected, or no-op).

---

## Error handling

- Individual client failures are caught and reported inline (e.g. `✗ OpenCode  failed to write plugin: EACCES`) — setup continues with remaining clients
- Non-zero exit code only if **all** detected clients failed
- If no clients are detected: print a message listing what to install, exit 0

---

## New files

| File | Purpose |
|---|---|
| `src/setup.ts` | `runSetup()` function, client descriptors, file writers |
| `src/setup.test.ts` | Unit tests using temp directories (no real home dir writes) |

---

## Testing approach

Tests use a fake `homeDir` and `cwd` injected via a `SetupOptions` parameter:

```ts
interface SetupOptions {
  homeDir?: string  // default: os.homedir()
  cwd?: string      // default: process.cwd()
  log?: (line: string) => void  // default: console.log
}

export async function runSetup(opts?: SetupOptions): Promise<void>
```

Test cases:
- OpenCode detected: plugin written, AGENTS.md created
- OpenCode detected, AGENTS.md already has sentinel: section not duplicated
- OpenCode detected, plugin already exists: overwritten
- Claude Code detected: CLAUDE.md created
- Claude Code detected, CLAUDE.md exists with sentinel: not duplicated
- Cursor detected: rules file written
- VS Code detected: `.github/` created, copilot-instructions.md written
- No clients detected: graceful message, exit 0
- Multiple clients detected: all handled independently
- One client write fails: others still proceed
