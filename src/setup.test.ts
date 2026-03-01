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
      expect(lines.some((l) => l.includes('(no clients detected)'))).toBe(true)
    } finally {
      await rm(home, { recursive: true, force: true })
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
