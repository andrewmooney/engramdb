import type Database from 'better-sqlite3';
import { embed } from '../embeddings.js';
import { queryMemories } from '../memory.js';

export async function handleSearchGlobal(
  db: Database.Database,
  input: { query: string; limit?: number }
) {
  if (!input.query?.trim()) throw new Error('query is required and must not be empty');
  const embedding = await embed(input.query).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[mtmem] Embedding failed: ${msg}`);
  });
  return queryMemories(db, { embedding, limit: Math.min(input.limit ?? 10, 50) });
}
