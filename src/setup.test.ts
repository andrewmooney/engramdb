import { describe, it, expect } from 'vitest'
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSetup, appendAgentsMd, pathExists } from './setup.js'

describe('runSetup', () => {
  it('runs without error when no clients are detected', async () => {
    const home = await mkdtemp(join(tmpdir(), 'engramdb-setup-test-'))
    const cwd = await mkdtemp(join(tmpdir(), 'engramdb-setup-cwd-'))
    const lines: string[] = []
    try {
      await expect(
        runSetup({ homeDir: home, cwd, log: (l) => lines.push(l) })
      ).resolves.toBeUndefined()
      expect(lines.some((l) => l.includes('(no clients detected)'))).toBe(true)
    } finally {
      await rm(home, { recursive: true, force: true })
      await rm(cwd, { recursive: true, force: true })
    }
  })
})

it('detects OpenCode when ~/.config/opencode/ exists', async () => {
  const home = await mkdtemp(join(tmpdir(), 'engramdb-setup-test-'))
  const cwd = await mkdtemp(join(tmpdir(), 'engramdb-setup-cwd-'))
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
  const home = await mkdtemp(join(tmpdir(), 'engramdb-setup-test-'))
  const cwd = await mkdtemp(join(tmpdir(), 'engramdb-setup-cwd-'))
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
  const home = await mkdtemp(join(tmpdir(), 'engramdb-setup-test-'))
  const cwd = await mkdtemp(join(tmpdir(), 'engramdb-setup-cwd-'))
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
  const home = await mkdtemp(join(tmpdir(), 'engramdb-setup-test-'))
  const cwd = await mkdtemp(join(tmpdir(), 'engramdb-setup-cwd-'))
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

it('appendAgentsMd creates file when absent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'engramdb-agents-test-'))
  try {
    const filePath = join(dir, 'AGENTS.md')
    await appendAgentsMd(filePath)
    const content = await readFile(filePath, 'utf8')
    expect(content).toContain('## Memory (engramdb)')
    expect(content).toContain('remember_memory')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

it('appendAgentsMd appends to existing file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'engramdb-agents-test-'))
  try {
    const filePath = join(dir, 'AGENTS.md')
    await writeFile(filePath, '# Existing content\n\nSome rules here.\n')
    await appendAgentsMd(filePath)
    const content = await readFile(filePath, 'utf8')
    expect(content).toContain('# Existing content')
    expect(content).toContain('## Memory (engramdb)')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

it('OpenCode: writes plugin, updates package.json, writes AGENTS.md', async () => {
  const home = await mkdtemp(join(tmpdir(), 'engramdb-setup-test-'))
  const cwd = await mkdtemp(join(tmpdir(), 'engramdb-setup-cwd-'))
  const lines: string[] = []
  try {
    await mkdir(join(home, '.config', 'opencode'), { recursive: true })
    await runSetup({ homeDir: home, cwd, log: (l) => lines.push(l) })

    // Plugin written
    const plugin = await readFile(join(home, '.config', 'opencode', 'plugins', 'engramdb.ts'), 'utf8')
    expect(plugin).toContain('EngramdbPlugin')

    // package.json has dependency
    const pkg = JSON.parse(await readFile(join(home, '.config', 'opencode', 'package.json'), 'utf8'))
    expect(pkg.dependencies?.['@opencode-ai/plugin']).toBeTruthy()

    // AGENTS.md written
    const agents = await readFile(join(home, '.config', 'opencode', 'AGENTS.md'), 'utf8')
    expect(agents).toContain('## Memory (engramdb)')

    // Output line
    expect(lines.some((l) => l.includes('OpenCode') && l.includes('✓'))).toBe(true)
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  }
})

it('OpenCode: merges into existing package.json without clobbering', async () => {
  const home = await mkdtemp(join(tmpdir(), 'engramdb-setup-test-'))
  const cwd = await mkdtemp(join(tmpdir(), 'engramdb-setup-cwd-'))
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
  const home = await mkdtemp(join(tmpdir(), 'engramdb-setup-test-'))
  const cwd = await mkdtemp(join(tmpdir(), 'engramdb-setup-cwd-'))
  try {
    await mkdir(join(home, '.config', 'opencode', 'plugins'), { recursive: true })
    await writeFile(join(home, '.config', 'opencode', 'plugins', 'engramdb.ts'), '// old plugin')
    await runSetup({ homeDir: home, cwd, log: () => {} })
    const plugin = await readFile(join(home, '.config', 'opencode', 'plugins', 'engramdb.ts'), 'utf8')
    expect(plugin).not.toContain('// old plugin')
    expect(plugin).toContain('EngramdbPlugin')
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  }
})

it('appendAgentsMd does not duplicate when sentinel present', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'engramdb-agents-test-'))
  try {
    const filePath = join(dir, 'AGENTS.md')
    await appendAgentsMd(filePath)
    await appendAgentsMd(filePath) // second call
    const content = await readFile(filePath, 'utf8')
    const count = (content.match(/## Memory \(engramdb\)/g) ?? []).length
    expect(count).toBe(1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

it('Claude Code: creates ~/.claude/CLAUDE.md', async () => {
  const home = await mkdtemp(join(tmpdir(), 'engramdb-setup-test-'))
  const cwd = await mkdtemp(join(tmpdir(), 'engramdb-setup-cwd-'))
  try {
    await mkdir(join(home, '.claude'), { recursive: true })
    await runSetup({ homeDir: home, cwd, log: () => {} })
    const content = await readFile(join(home, '.claude', 'CLAUDE.md'), 'utf8')
    expect(content).toContain('## Memory (engramdb)')
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  }
})

it('Cursor: creates ~/.cursor/rules/engramdb.md', async () => {
  const home = await mkdtemp(join(tmpdir(), 'engramdb-setup-test-'))
  const cwd = await mkdtemp(join(tmpdir(), 'engramdb-setup-cwd-'))
  try {
    await mkdir(join(home, '.cursor'), { recursive: true })
    await runSetup({ homeDir: home, cwd, log: () => {} })
    const content = await readFile(join(home, '.cursor', 'rules', 'engramdb.md'), 'utf8')
    expect(content).toContain('## Memory (engramdb)')
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  }
})

it('VS Code Copilot: creates .github/copilot-instructions.md in cwd', async () => {
  const home = await mkdtemp(join(tmpdir(), 'engramdb-setup-test-'))
  const cwd = await mkdtemp(join(tmpdir(), 'engramdb-setup-cwd-'))
  try {
    await mkdir(join(home, '.vscode'), { recursive: true })
    await runSetup({ homeDir: home, cwd, log: () => {} })
    const content = await readFile(join(cwd, '.github', 'copilot-instructions.md'), 'utf8')
    expect(content).toContain('## Memory (engramdb)')
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  }
})

it('OPENCODE_PLUGIN_SOURCE uses index-based dedup (lastAppendedIndexMap)', async () => {
  const { OPENCODE_PLUGIN_SOURCE } = await import('./setup.js')
  expect(OPENCODE_PLUGIN_SOURCE).toContain('lastAppendedIndexMap')
  expect(OPENCODE_PLUGIN_SOURCE).not.toContain('lastAppendedMap')
})

it('OPENCODE_PLUGIN_SOURCE uses session.status instead of session.idle', async () => {
  const { OPENCODE_PLUGIN_SOURCE } = await import('./setup.js')
  expect(OPENCODE_PLUGIN_SOURCE).toContain('session.status')
  expect(OPENCODE_PLUGIN_SOURCE).not.toContain('session.idle')
})

it('Claude Desktop: detected but no files written', async () => {
  const home = await mkdtemp(join(tmpdir(), 'engramdb-setup-test-'))
  const cwd = await mkdtemp(join(tmpdir(), 'engramdb-setup-cwd-'))
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
