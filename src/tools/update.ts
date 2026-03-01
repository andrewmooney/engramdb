import type Database from 'better-sqlite3';
import type { MemoryType } from '../types.js';
import { embed } from '../embeddings.js';
import { updateMemory } from '../memory.js';

export async function handleUpdate(
  db: Database.Database,
  input: { id: string; content?: string; importance?: number; type?: MemoryType }
) {
  const embedding = input.content ? await embed(input.content).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[engramdb] Embedding failed: ${msg}`);
  }) : undefined;
  const importance = input.importance !== undefined ? Math.max(0, Math.min(1, input.importance)) : undefined;
  const result = updateMemory(db, input.id, { ...input, importance, embedding });
  if (!result) throw new Error(`Memory not found: ${input.id}`);
  return result;
}
