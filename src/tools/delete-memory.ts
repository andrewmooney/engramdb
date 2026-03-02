import type Database from 'better-sqlite3';
import { deleteMemory } from '../memory.js';

export function handleDeleteMemory(
  db: Database.Database,
  input: { id: string }
): { deleted: boolean; id: string } {
  return deleteMemory(db, input.id);
}
