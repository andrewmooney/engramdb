import { describe, it, expect } from 'vitest'
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSetup, appendAgentsMd } from './setup.js'

describe('runSetup', () => {
  it('runs without error when no clients are detected', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mtmem-setup-test-'))
    const cwd = await mkdtemp(join(tmpdir(), 'mtmem-setup-cwd-'))
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
