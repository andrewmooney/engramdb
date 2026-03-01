import type Database from 'better-sqlite3';
import type { MemoryType } from '../types.js';
import { embed } from '../embeddings.js';
import { updateMemory } from '../memory.js';

export async function handleUpdate(
  db: Database.Database,
  input: { id: string; content?: string; importance?: number; type?: MemoryType }
) {
  const embedding = input.content ? await embed(input.content) : undefined;
  const result = updateMemory(db, input.id, { ...input, embedding });
  if (!result) throw new Error(`Memory not found: ${input.id}`);
  return result;
}
