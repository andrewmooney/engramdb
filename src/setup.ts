import { homedir } from 'node:os'
import { join } from 'node:path'
import { access, readFile, writeFile } from 'node:fs/promises'

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

export async function pathExists(p: string): Promise<boolean> {
  try { await access(p); return true } catch { return false }
}

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
