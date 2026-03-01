import { homedir } from 'node:os'
import { join } from 'node:path'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'

export interface SetupOptions {
  homeDir?: string
  cwd?: string
  log?: (line: string) => void
}

interface ClientDescriptor {
  label: string
  detectionPath: (home: string) => string
  setup?: (home: string, cwd: string, log: (l: string) => void) => Promise<void>
  report?: (log: (l: string) => void) => void
}

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
  const result = await $\`engramdb\`.stdin(json).json()
  return result
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
          const title = \`OpenCode session \${new Date().toISOString()}\`
          const convResult = await callMtmem("start_conversation", {
            project_id: projectId, agent_id: agentId, title,
          }) as { result?: { content?: Array<{ text?: string }> } }
          const text = convResult?.result?.content?.[0]?.text ?? "{}"
          const parsed = JSON.parse(text) as { id?: string }
          if (parsed.id) conversationMap.set(sessionId, parsed.id)
          await callMtmem("recall_memories", { project_id: projectId, query: "recent work, decisions, patterns", limit: 10 })
          await callMtmem("search_conversations", { project_id: projectId, query: "recent sessions", limit: 3 })
          await client.app.log({ body: { service: "engramdb-plugin", level: "info", message: "session.created: conversation opened", extra: { sessionId, conversationId: parsed.id } } })
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
            await client.app.log({ body: { service: "engramdb-plugin", level: "debug", message: "session.idle: turn appended", extra: { sessionID, msgId } } })
          } catch (err) {
            await client.app.log({ body: { service: "engramdb-plugin", level: "warn", message: "session.idle: append_turn failed", extra: { error: String(err), sessionID } } })
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
            await client.app.log({ body: { service: "engramdb-plugin", level: "info", message: "session.deleted: conversation closed", extra: { sessionId, conversationId } } })
          } catch (err) {
            await client.app.log({ body: { service: "engramdb-plugin", level: "warn", message: "session.deleted: close_conversation failed", extra: { error: String(err), sessionId } } })
            conversationMap.delete(sessionId)
            lastAppendedMap.delete(sessionId)
          }
        } else if (event.type.startsWith("session.")) {
          await client.app.log({ body: { service: "engramdb-plugin", level: "debug", message: \`event: \${event.type}\`, extra: event.properties } })
        }
      } catch (err) {
        try {
          await client.app.log({ body: { service: "engramdb-plugin", level: "warn", message: "engramdb-plugin event handler error", extra: { event: event.type, error: String(err) } } })
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
  await writeFile(join(pluginsDir, 'engramdb.ts'), OPENCODE_PLUGIN_SOURCE)

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

  log('  ✓ OpenCode        plugin installed, AGENTS.md updated')}

async function setupClaudeCode(home: string, log: (l: string) => void): Promise<void> {
  await appendAgentsMd(join(home, '.claude', 'CLAUDE.md'))
  log('  ✓ Claude Code     CLAUDE.md updated')
}

async function setupCursor(home: string, log: (l: string) => void): Promise<void> {
  const rulesDir = join(home, '.cursor', 'rules')
  await mkdir(rulesDir, { recursive: true })
  await writeFile(join(rulesDir, 'engramdb.md'), AGENTS_MD_SECTION.trim())
  log('  ✓ Cursor          rules file written (~/.cursor/rules/engramdb.md)')
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

const CLIENTS: ClientDescriptor[] = [
  { label: 'OpenCode',        detectionPath: (h) => join(h, '.config', 'opencode'), setup: (h, _c, l) => setupOpenCode(h, l) },
  { label: 'Claude Code',     detectionPath: (h) => join(h, '.claude'),             setup: (h, _c, l) => setupClaudeCode(h, l) },
  { label: 'Cursor',          detectionPath: (h) => join(h, '.cursor'),             setup: (h, _c, l) => setupCursor(h, l) },
  { label: 'VS Code Copilot', detectionPath: (h) => join(h, '.vscode'),             setup: (h, c, l) => setupVSCode(h, c, l) },
  { label: 'Claude Desktop',  detectionPath: (h) =>
      process.platform === 'win32'
        ? join(process.env['APPDATA'] ?? join(h, 'AppData', 'Roaming'), 'Claude')
        : join(h, 'Library', 'Application Support', 'Claude'),
    report: reportClaudeDesktop },
]

export async function pathExists(p: string): Promise<boolean> {
  try { await access(p); return true } catch { return false }
}

const AGENTS_SENTINEL = '## Memory (engramdb)'

const AGENTS_MD_SECTION = `
## Memory (engramdb)

You have persistent memory via the \`engramdb\` MCP server. A plugin handles the lifecycle
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

export async function runSetup(opts?: SetupOptions): Promise<void> {
  const home = opts?.homeDir ?? homedir()
  const cwd = opts?.cwd ?? process.cwd()
  const log = opts?.log ?? console.log

  log('\nengramdb setup\n')

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
    try {
      if (client.setup) {
        await client.setup(home, cwd, log)
      } else if (client.report) {
        client.report(log)
      }
    } catch (err) {
      log(`  ✗ ${client.label.padEnd(16)} failed: ${String(err)}`)
    }
  }

  log('\nSetup complete. Restart your AI client to load the changes.')
}
