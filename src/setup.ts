import { homedir } from 'node:os'

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
