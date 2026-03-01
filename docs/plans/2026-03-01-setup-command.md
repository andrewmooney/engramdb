# Setup Command Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `mtmem setup` subcommand that detects installed AI clients and writes agent instruction files (and the OpenCode lifecycle plugin) so users get persistent memory with zero manual configuration.

**Architecture:** `src/index.ts` dispatches to `src/setup.ts` when `process.argv[2] === 'setup'`, before any DB or server initialization. `setup.ts` exports `runSetup(opts?)` with injectable `homeDir`, `cwd`, and `log` for testability. Client descriptors are a typed array iterated at runtime — adding a new client is one array entry.

**Tech Stack:** Node.js ≥ 20 (ESM), TypeScript strict, `node:fs/promises`, `node:os`, `node:path`. No new dependencies. Tests in Vitest with temp directories (no writes to real home dir).

**Design doc:** `docs/plans/2026-03-01-setup-command-design.md`

---

## Task 1: Scaffold `src/setup.ts` with `SetupOptions` and stub `runSetup`

**Files:**
- Create: `src/setup.ts`
- Create: `src/setup.test.ts`

### Step 1: Write the failing test

```ts
// src/setup.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSetup } from './setup.js'

describe('runSetup', () => {
  it('runs without error when no clients are detected', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mtmem-setup-test-'))
    const cwd = await mkdtemp(join(tmpdir(), 'mtmem-setup-cwd-'))
    const lines: string[] = []
    try {
      await expect(
        runSetup({ homeDir: home, cwd, log: (l) => lines.push(l) })
      ).resolves.toBeUndefined()
      expect(lines.some((l) => l.includes('no clients detected') || l.includes('not detected'))).toBe(true)
    } finally {
      await rm(home, { recursive: true, force: true })
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
```

Run: `npm test -- --reporter=verbose src/setup.test.ts`
Expected: FAIL — `Cannot find module './setup.js'`

### Step 2: Create `src/setup.ts` scaffold

```ts
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface SetupOptions {
  homeDir?: string
  cwd?: string
  log?: (line: string) => void
}

export async function runSetup(opts?: SetupOptions): Promise<void> {
  const home = opts?.homeDir ?? homedir()
  const cwd = opts?.cwd ?? process.cwd()
  const log = opts?.log ?? console.log

  log('\nmtmem setup\n')
  log('Detected clients:')
  log('  (no clients detected)\n')
  log('Setup complete.')
}
```

### Step 3: Run test to verify it passes

Run: `npm test -- --reporter=verbose src/setup.test.ts`
Expected: PASS

### Step 4: Commit

```bash
git add src/setup.ts src/setup.test.ts
git commit -m "feat: scaffold setup command with runSetup stub"
```

---

## Task 2: Client detection

**Files:**
- Modify: `src/setup.ts`
- Modify: `src/setup.test.ts`

Each client is a descriptor object. Detection is a path-existence check.

### Step 1: Write failing tests

Add to `src/setup.test.ts`:

```ts
import { mkdir } from 'node:fs/promises'

it('detects OpenCode when ~/.config/opencode/ exists', async () => {
  const home = await mkdtemp(join(tmpdir(), 'mtmem-setup-test-'))
  const cwd = await mkdtemp(join(tmpdir(), 'mtmem-setup-cwd-'))
  const lines: string[] = []
  try {
    await mkdir(join(home, '.config', 'opencode'), { recursive: true })
    await runSetup({ homeDir: home, cwd, log: (l) => lines.push(l) })
    expect(lines.some((l) => l.includes('OpenCode'))).toBe(true)
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  }
})

it('detects Claude Code when ~/.claude/ exists', async () => {
  const home = await mkdtemp(join(tmpdir(), 'mtmem-setup-test-'))
  const cwd = await mkdtemp(join(tmpdir(), 'mtmem-setup-cwd-'))
  const lines: string[] = []
  try {
    await mkdir(join(home, '.claude'), { recursive: true })
    await runSetup({ homeDir: home, cwd, log: (l) => lines.push(l) })
    expect(lines.some((l) => l.includes('Claude Code'))).toBe(true)
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  }
})

it('detects Cursor when ~/.cursor/ exists', async () => {
  const home = await mkdtemp(join(tmpdir(), 'mtmem-setup-test-'))
  const cwd = await mkdtemp(join(tmpdir(), 'mtmem-setup-cwd-'))
  const lines: string[] = []
  try {
    await mkdir(join(home, '.cursor'), { recursive: true })
    await runSetup({ homeDir: home, cwd, log: (l) => lines.push(l) })
    expect(lines.some((l) => l.includes('Cursor'))).toBe(true)
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  }
})

it('detects VS Code when ~/.vscode/ exists', async () => {
  const home = await mkdtemp(join(tmpdir(), 'mtmem-setup-test-'))
  const cwd = await mkdtemp(join(tmpdir(), 'mtmem-setup-cwd-'))
  const lines: string[] = []
  try {
    await mkdir(join(home, '.vscode'), { recursive: true })
    await runSetup({ homeDir: home, cwd, log: (l) => lines.push(l) })
    expect(lines.some((l) => l.includes('VS Code'))).toBe(true)
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  }
})
```

Run: `npm test -- --reporter=verbose src/setup.test.ts`
Expected: all new tests FAIL

### Step 2: Implement client descriptors and detection

Replace the body of `src/setup.ts` with:

```ts
import { homedir } from 'node:os'
import { join } from 'node:path'
import { access } from 'node:fs/promises'

export interface SetupOptions {
  homeDir?: string
  cwd?: string
  log?: (line: string) => void
}

interface ClientDescriptor {
  label: string
  detectionPath: (home: string) => string
}

const CLIENTS: ClientDescriptor[] = [
  { label: 'OpenCode',        detectionPath: (h) => join(h, '.config', 'opencode') },
  { label: 'Claude Code',     detectionPath: (h) => join(h, '.claude') },
  { label: 'Cursor',          detectionPath: (h) => join(h, '.cursor') },
  { label: 'VS Code Copilot', detectionPath: (h) => join(h, '.vscode') },
  { label: 'Claude Desktop',  detectionPath: (h) =>
      process.platform === 'win32'
        ? join(process.env['APPDATA'] ?? join(h, 'AppData', 'Roaming'), 'Claude')
        : join(h, 'Library', 'Application Support', 'Claude') },
]

async function pathExists(p: string): Promise<boolean> {
  try { await access(p); return true } catch { return false }
}

export async function runSetup(opts?: SetupOptions): Promise<void> {
  const home = opts?.homeDir ?? homedir()
  const cwd = opts?.cwd ?? process.cwd()
  const log = opts?.log ?? console.log

  log('\nmtmem setup\n')

  const detected: ClientDescriptor[] = []
  for (const client of CLIENTS) {
    if (await pathExists(client.detectionPath(home))) {
      detected.push(client)
    }
  }

  log('Detected clients:')
  if (detected.length === 0) {
    log('  (no clients detected)\n')
    log('Install an AI client (OpenCode, Claude Code, Cursor, or VS Code with Copilot) and re-run setup.')
    return
  }

  for (const client of detected) {
    log(`  ${client.label}`)
  }

  log('\nSetup complete.')
}
```

### Step 3: Run tests

Run: `npm test -- --reporter=verbose src/setup.test.ts`
Expected: all tests PASS

### Step 4: Commit

```bash
git add src/setup.ts src/setup.test.ts
git commit -m "feat: add client detection to setup command"
```

---

## Task 3: AGENTS.md content constants and append helper

**Files:**
- Modify: `src/setup.ts`
- Modify: `src/setup.test.ts`

The AGENTS.md content and a sentinel string are used by multiple clients. The append helper is shared.

### Step 1: Write failing test for append helper

Add to `src/setup.test.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { appendAgentsMd } from './setup.js'

it('appendAgentsMd creates file when absent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mtmem-agents-test-'))
  try {
    const filePath = join(dir, 'AGENTS.md')
    await appendAgentsMd(filePath)
    const content = await readFile(filePath, 'utf8')
    expect(content).toContain('## Memory (mtmem)')
    expect(content).toContain('remember_memory')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

it('appendAgentsMd appends to existing file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mtmem-agents-test-'))
  try {
    const filePath = join(dir, 'AGENTS.md')
    await writeFile(filePath, '# Existing content\n\nSome rules here.\n')
    await appendAgentsMd(filePath)
    const content = await readFile(filePath, 'utf8')
    expect(content).toContain('# Existing content')
    expect(content).toContain('## Memory (mtmem)')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

it('appendAgentsMd does not duplicate when sentinel present', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mtmem-agents-test-'))
  try {
    const filePath = join(dir, 'AGENTS.md')
    await appendAgentsMd(filePath)
    await appendAgentsMd(filePath) // second call
    const content = await readFile(filePath, 'utf8')
    const count = (content.match(/## Memory \(mtmem\)/g) ?? []).length
    expect(count).toBe(1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
```

Add `import { writeFile } from 'node:fs/promises'` to the test file imports.

Run: `npm test -- --reporter=verbose src/setup.test.ts`
Expected: new tests FAIL — `appendAgentsMd` not exported

### Step 2: Implement the content constants and append helper

Add to `src/setup.ts` (after imports, before `SetupOptions`):

```ts
import { readFile, writeFile, mkdir } from 'node:fs/promises'

const AGENTS_SENTINEL = '## Memory (mtmem)'

const AGENTS_MD_SECTION = `
## Memory (mtmem)

You have persistent memory via the \`mtmem\` MCP server. A plugin handles the lifecycle
automatically (opening/closing conversations, loading prior context at session start).
Your job is to make judgment calls about what's worth storing.

### When to call \`remember_memory\`

Call it when you learn something worth carrying into future sessions:
- Architectural decisions ("We use WAL mode for SQLite in this project")
- User preferences ("The user prefers functional style over classes")
- Recurring patterns ("All imports use \`.js\` extension — ESM TypeScript convention")
- Gotchas / debugging findings ("sqlite-vec requires extension loading before vec0 queries")
- Project constraints ("Node.js >= 20 required; no CommonJS")

Do NOT store: transient state, things already visible in the codebase, things that will be outdated immediately.

### \`importance\` guide

| Value | Use when |
|-------|----------|
| \`0.9\` | Project-wide conventions, hard constraints |
| \`0.7\` | Common patterns, repeated preferences |
| \`0.5\` | Session-specific notes, one-off observations |

### \`type\` guide

| Type | Use for |
|------|---------|
| \`decision\` | Architectural or design choices |
| \`preference\` | User style or workflow preferences |
| \`code_pattern\` | Recurring code patterns or conventions |
| \`fact\` | General facts about the project |
| \`observation\` | Things you noticed that may be useful later |

### When to call \`append_turn\` manually

The plugin appends assistant turns automatically. Call \`append_turn(role="user", ...)\`
manually if the user's message contains an important decision or constraint that you want
preserved in the conversation log.
`

export async function appendAgentsMd(filePath: string): Promise<void> {
  let existing = ''
  try {
    existing = await readFile(filePath, 'utf8')
  } catch {
    // file does not exist — create it
  }
  if (existing.includes(AGENTS_SENTINEL)) return
  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
  await writeFile(filePath, existing + separator + AGENTS_MD_SECTION)
}
```

### Step 3: Run tests

Run: `npm test -- --reporter=verbose src/setup.test.ts`
Expected: all tests PASS

### Step 4: Commit

```bash
git add src/setup.ts src/setup.test.ts
git commit -m "feat: add AGENTS.md content and append helper"
```

---

## Task 4: OpenCode client handler

**Files:**
- Modify: `src/setup.ts`
- Modify: `src/setup.test.ts`

OpenCode handler: write plugin, patch `package.json`, append AGENTS.md.

### Step 1: Write failing tests

Add to `src/setup.test.ts`:

```ts
it('OpenCode: writes plugin, updates package.json, writes AGENTS.md', async () => {
  const home = await mkdtemp(join(tmpdir(), 'mtmem-setup-test-'))
  const cwd = await mkdtemp(join(tmpdir(), 'mtmem-setup-cwd-'))
  const lines: string[] = []
  try {
    await mkdir(join(home, '.config', 'opencode'), { recursive: true })
    await runSetup({ homeDir: home, cwd, log: (l) => lines.push(l) })

    // Plugin written
    const plugin = await readFile(join(home, '.config', 'opencode', 'plugins', 'mtmem.ts'), 'utf8')
    expect(plugin).toContain('MtmemPlugin')

    // package.json has dependency
    const pkg = JSON.parse(await readFile(join(home, '.config', 'opencode', 'package.json'), 'utf8'))
    expect(pkg.dependencies?.['@opencode-ai/plugin']).toBeTruthy()

    // AGENTS.md written
    const agents = await readFile(join(home, '.config', 'opencode', 'AGENTS.md'), 'utf8')
    expect(agents).toContain('## Memory (mtmem)')

    // Output line
    expect(lines.some((l) => l.includes('OpenCode') && l.includes('✓'))).toBe(true)
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  }
})

it('OpenCode: merges into existing package.json without clobbering', async () => {
  const home = await mkdtemp(join(tmpdir(), 'mtmem-setup-test-'))
  const cwd = await mkdtemp(join(tmpdir(), 'mtmem-setup-cwd-'))
  try {
    await mkdir(join(home, '.config', 'opencode'), { recursive: true })
    await writeFile(
      join(home, '.config', 'opencode', 'package.json'),
      JSON.stringify({ dependencies: { 'some-other-package': '1.0.0' } })
    )
    await runSetup({ homeDir: home, cwd, log: () => {} })
    const pkg = JSON.parse(await readFile(join(home, '.config', 'opencode', 'package.json'), 'utf8'))
    expect(pkg.dependencies?.['some-other-package']).toBe('1.0.0')
    expect(pkg.dependencies?.['@opencode-ai/plugin']).toBeTruthy()
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  }
})

it('OpenCode: overwrites plugin file on re-run', async () => {
  const home = await mkdtemp(join(tmpdir(), 'mtmem-setup-test-'))
  const cwd = await mkdtemp(join(tmpdir(), 'mtmem-setup-cwd-'))
  try {
    await mkdir(join(home, '.config', 'opencode', 'plugins'), { recursive: true })
    await writeFile(join(home, '.config', 'opencode', 'plugins', 'mtmem.ts'), '// old plugin')
    await runSetup({ homeDir: home, cwd, log: () => {} })
    const plugin = await readFile(join(home, '.config', 'opencode', 'plugins', 'mtmem.ts'), 'utf8')
    expect(plugin).not.toContain('// old plugin')
    expect(plugin).toContain('MtmemPlugin')
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  }
})
```

Run: `npm test -- --reporter=verbose src/setup.test.ts`
Expected: new tests FAIL

### Step 2: Implement OpenCode handler

The plugin source is embedded verbatim. Add to `src/setup.ts`:

```ts
const OPENCODE_PLUGIN_SOURCE = `import type { Plugin } from "@opencode-ai/plugin"
import { $ } from "bun"
import path from "path"

const conversationMap = new Map<string, string>()
const lastAppendedMap = new Map<string, string>()
let rpcId = 0

async function callMtmem(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const request = {
    jsonrpc: "2.0",
    id: ++rpcId,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  }
  const json = JSON.stringify(request)
  const result = await $\`mtmem\`.stdin(json).json()
  return result
}

export const MtmemPlugin: Plugin = async ({ client, directory }) => {
  const projectId = path.basename(directory)
  const agentId = "opencode"

  return {
    event: async ({ event }) => {
      try {
        if (event.type === "session.created") {
          const sessionId = (event.properties as { info?: { id?: string } })?.info?.id
          if (!sessionId) return
          const title = \`OpenCode session \${new Date().toISOString()}\`
          const convResult = await callMtmem("start_conversation", {
            project_id: projectId, agent_id: agentId, title,
          }) as { result?: { content?: Array<{ text?: string }> } }
          const text = convResult?.result?.content?.[0]?.text ?? "{}"
          const parsed = JSON.parse(text) as { id?: string }
          if (parsed.id) conversationMap.set(sessionId, parsed.id)
          await callMtmem("recall_memories", { project_id: projectId, query: "recent work, decisions, patterns", limit: 10 })
          await callMtmem("search_conversations", { project_id: projectId, query: "recent sessions", limit: 3 })
          await client.app.log({ body: { service: "mtmem-plugin", level: "info", message: "session.created: conversation opened", extra: { sessionId, conversationId: parsed.id } } })
        } else if (event.type === "session.idle") {
          const sessionID = (event.properties as { sessionID?: string }).sessionID
          if (!sessionID) return
          const conversationId = conversationMap.get(sessionID)
          if (!conversationId) return
          try {
            const messages = await client.session.messages({ path: { id: sessionID } })
            const all = messages.data ?? []
            const lastAssistant = [...all].reverse().find((m) => m.info?.role === "assistant")
            if (!lastAssistant) return
            const msgId = lastAssistant.info?.id
            if (msgId && lastAppendedMap.get(sessionID) === msgId) return
            const content = (lastAssistant.parts ?? []).filter((p) => p.type === "text").map((p) => (p as { text?: string }).text ?? "").join("\\n").trim()
            if (!content) return
            await callMtmem("append_turn", { conversation_id: conversationId, role: "assistant", content })
            if (msgId) lastAppendedMap.set(sessionID, msgId)
            await client.app.log({ body: { service: "mtmem-plugin", level: "debug", message: "session.idle: turn appended", extra: { sessionID, msgId } } })
          } catch (err) {
            await client.app.log({ body: { service: "mtmem-plugin", level: "warn", message: "session.idle: append_turn failed", extra: { error: String(err), sessionID } } })
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
              return \`\${role}: \${text}\`
            }).join("\\n")
            await callMtmem("close_conversation", { conversation_id: conversationId, summary: summary || "Session ended." })
            conversationMap.delete(sessionId)
            lastAppendedMap.delete(sessionId)
            await client.app.log({ body: { service: "mtmem-plugin", level: "info", message: "session.deleted: conversation closed", extra: { sessionId, conversationId } } })
          } catch (err) {
            await client.app.log({ body: { service: "mtmem-plugin", level: "warn", message: "session.deleted: close_conversation failed", extra: { error: String(err), sessionId } } })
            conversationMap.delete(sessionId)
            lastAppendedMap.delete(sessionId)
          }
        } else if (event.type.startsWith("session.")) {
          await client.app.log({ body: { service: "mtmem-plugin", level: "debug", message: \`event: \${event.type}\`, extra: event.properties } })
        }
      } catch (err) {
        try {
          await client.app.log({ body: { service: "mtmem-plugin", level: "warn", message: "mtmem-plugin event handler error", extra: { event: event.type, error: String(err) } } })
        } catch { /* never throw */ }
      }
    },
  }
}
`

async function setupOpenCode(home: string, log: (l: string) => void): Promise<void> {
  const baseDir = join(home, '.config', 'opencode')
  const pluginsDir = join(baseDir, 'plugins')

  // 1. Write plugin
  await mkdir(pluginsDir, { recursive: true })
  await writeFile(join(pluginsDir, 'mtmem.ts'), OPENCODE_PLUGIN_SOURCE)

  // 2. Patch package.json
  const pkgPath = join(baseDir, 'package.json')
  let pkg: Record<string, unknown> = {}
  try {
    pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  } catch { /* create fresh */ }
  const deps = (pkg['dependencies'] as Record<string, string> | undefined) ?? {}
  deps['@opencode-ai/plugin'] = 'latest'
  pkg['dependencies'] = deps
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

  // 3. Append AGENTS.md
  await appendAgentsMd(join(baseDir, 'AGENTS.md'))

  log('  ✓ OpenCode        plugin installed, AGENTS.md updated')
}
```

Wire `setupOpenCode` into `runSetup` by extending `ClientDescriptor` to include an optional `setup` async function and calling it when the client is detected. The Claude Desktop client descriptor has no `setup` function (only reported as detected).

Update `runSetup` to call `client.setup?.(home, cwd, log)` per detected client, catching errors per-client.

### Step 3: Run tests

Run: `npm test -- --reporter=verbose src/setup.test.ts`
Expected: all tests PASS

### Step 4: Run full test suite to confirm nothing broken

Run: `npm test`
Expected: all tests PASS

### Step 5: Commit

```bash
git add src/setup.ts src/setup.test.ts
git commit -m "feat: implement OpenCode client handler in setup command"
```

---

## Task 5: Claude Code, Cursor, VS Code Copilot, and Claude Desktop handlers

**Files:**
- Modify: `src/setup.ts`
- Modify: `src/setup.test.ts`

### Step 1: Write failing tests

Add to `src/setup.test.ts`:

```ts
it('Claude Code: creates ~/.claude/CLAUDE.md', async () => {
  const home = await mkdtemp(join(tmpdir(), 'mtmem-setup-test-'))
  const cwd = await mkdtemp(join(tmpdir(), 'mtmem-setup-cwd-'))
  try {
    await mkdir(join(home, '.claude'), { recursive: true })
    await runSetup({ homeDir: home, cwd, log: () => {} })
    const content = await readFile(join(home, '.claude', 'CLAUDE.md'), 'utf8')
    expect(content).toContain('## Memory (mtmem)')
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  }
})

it('Cursor: creates ~/.cursor/rules/mtmem.md', async () => {
  const home = await mkdtemp(join(tmpdir(), 'mtmem-setup-test-'))
  const cwd = await mkdtemp(join(tmpdir(), 'mtmem-setup-cwd-'))
  try {
    await mkdir(join(home, '.cursor'), { recursive: true })
    await runSetup({ homeDir: home, cwd, log: () => {} })
    const content = await readFile(join(home, '.cursor', 'rules', 'mtmem.md'), 'utf8')
    expect(content).toContain('## Memory (mtmem)')
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  }
})

it('VS Code Copilot: creates .github/copilot-instructions.md in cwd', async () => {
  const home = await mkdtemp(join(tmpdir(), 'mtmem-setup-test-'))
  const cwd = await mkdtemp(join(tmpdir(), 'mtmem-setup-cwd-'))
  try {
    await mkdir(join(home, '.vscode'), { recursive: true })
    await runSetup({ homeDir: home, cwd, log: () => {} })
    const content = await readFile(join(cwd, '.github', 'copilot-instructions.md'), 'utf8')
    expect(content).toContain('## Memory (mtmem)')
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  }
})

it('Claude Desktop: detected but no files written', async () => {
  const home = await mkdtemp(join(tmpdir(), 'mtmem-setup-test-'))
  const cwd = await mkdtemp(join(tmpdir(), 'mtmem-setup-cwd-'))
  const lines: string[] = []
  try {
    // macOS detection path simulation
    await mkdir(join(home, 'Library', 'Application Support', 'Claude'), { recursive: true })
    await runSetup({ homeDir: home, cwd, log: (l) => lines.push(l) })
    expect(lines.some((l) => l.includes('Claude Desktop'))).toBe(true)
    // No files written (no AGENTS.md for Claude Desktop)
    const hasAgentsMd = await pathExists(join(home, 'Library', 'Application Support', 'Claude', 'AGENTS.md'))
    expect(hasAgentsMd).toBe(false)
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  }
})
```

Note: `pathExists` is already exported from `setup.ts` (make it exported in Task 2 for test use, or re-implement it inline in tests).

Run: `npm test -- --reporter=verbose src/setup.test.ts`
Expected: new tests FAIL

### Step 2: Implement remaining handlers

Add handler functions to `src/setup.ts`:

```ts
async function setupClaudeCode(home: string, log: (l: string) => void): Promise<void> {
  await appendAgentsMd(join(home, '.claude', 'CLAUDE.md'))
  log('  ✓ Claude Code     CLAUDE.md updated')
}

async function setupCursor(home: string, log: (l: string) => void): Promise<void> {
  const rulesDir = join(home, '.cursor', 'rules')
  await mkdir(rulesDir, { recursive: true })
  await writeFile(join(rulesDir, 'mtmem.md'), AGENTS_MD_SECTION.trim())
  log('  ✓ Cursor          rules file written (~/.cursor/rules/mtmem.md)')
}

async function setupVSCode(_home: string, cwd: string, log: (l: string) => void): Promise<void> {
  const githubDir = join(cwd, '.github')
  await mkdir(githubDir, { recursive: true })
  await appendAgentsMd(join(githubDir, 'copilot-instructions.md'))
  log('  ✓ VS Code Copilot .github/copilot-instructions.md updated')
}

function reportClaudeDesktop(log: (l: string) => void): void {
  log('  - Claude Desktop  detected — no instruction file path (configure manually via Claude Projects)')
}
```

Update `ClientDescriptor` to carry the right handler type:

```ts
interface ClientDescriptor {
  label: string
  detectionPath: (home: string) => string
  setup?: (home: string, cwd: string, log: (l: string) => void) => Promise<void>
}
```

And update `CLIENTS` array to wire each descriptor to its handler. Update `runSetup` to call `client.setup?.(home, cwd, log)` instead of `client.setup?.(home, log)` (pass cwd too for VS Code).

For error handling per client, wrap each call:

```ts
for (const client of detected) {
  try {
    if (client.setup) {
      await client.setup(home, cwd, log)
    }
  } catch (err) {
    log(`  ✗ ${client.label.padEnd(16)} failed: ${String(err)}`)
  }
}
```

### Step 3: Run tests

Run: `npm test -- --reporter=verbose src/setup.test.ts`
Expected: all tests PASS

### Step 4: Run full test suite

Run: `npm test`
Expected: all tests PASS

### Step 5: Commit

```bash
git add src/setup.ts src/setup.test.ts
git commit -m "feat: add Claude Code, Cursor, VS Code, and Claude Desktop handlers"
```

---

## Task 6: Wire `setup` into `src/index.ts` and polish output

**Files:**
- Modify: `src/index.ts`
- Modify: `src/setup.ts`

### Step 1: Add argv dispatch to `src/index.ts`

At the very top of `src/index.ts`, before any other imports or logic, add:

```ts
if (process.argv[2] === 'setup') {
  const { runSetup } = await import('./setup.js')
  await runSetup()
  process.exit(0)
}
```

> **Note:** This uses a top-level `await import()`. Since the file already uses top-level await (`await mcpServer.connect(transport)` at the bottom), this is valid.

### Step 2: Polish output

Update the output in `runSetup` so the final block looks like:

```
mtmem setup

Detected clients:
  ✓ OpenCode        plugin installed, AGENTS.md updated
  ✓ Claude Code     CLAUDE.md updated
  - Claude Desktop  detected — no instruction file path (configure manually via Claude Projects)

Setup complete. Restart your AI client to load the changes.
```

Add the final `\nSetup complete. Restart your AI client to load the changes.` line at the end of `runSetup` (only when at least one client was detected and handled without total failure).

### Step 3: Build and smoke test

```bash
npm run build
node dist/index.js setup
```

Expected: runs without error, prints output for detected clients.

### Step 4: Run full test suite

```bash
npm test
```

Expected: all 52+ tests PASS

### Step 5: Commit

```bash
git add src/index.ts src/setup.ts
git commit -m "feat: wire setup subcommand into mtmem entry point"
```

---

## Task 7: Update README

**Files:**
- Modify: `README.md`

Add a `## Setup` section immediately after the `## Quick start` section:

````markdown
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
````

### Step 1: Edit README.md

Insert the section after `## Quick start`.

### Step 2: Verify the README looks correct

Read it back and confirm the new section is in the right place.

### Step 3: Commit

```bash
git add README.md
git commit -m "docs: add setup command section to README"
```
