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

export async function pathExists(p: string): Promise<boolean> {
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
