import type Database from 'better-sqlite3';
import type { Memory, MemoryType } from '../types.js';
import { listMemories } from '../memory.js';

export function handleListMemories(
  db: Database.Database,
  input: { project_id: string; type?: MemoryType; agent_id?: string; limit?: number }
): Memory[] {
  return listMemories(db, input);
}
