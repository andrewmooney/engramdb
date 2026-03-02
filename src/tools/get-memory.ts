import type Database from 'better-sqlite3';
import type { Memory } from '../types.js';
import { getMemory } from '../memory.js';

export function handleGetMemory(
  db: Database.Database,
  input: { id: string }
): { found: true; memory: Memory } | { found: false; memory?: undefined } {
  const memory = getMemory(db, input.id);
  if (!memory) return { found: false };
  return { found: true, memory };
}
