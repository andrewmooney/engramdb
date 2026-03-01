import type Database from 'better-sqlite3';
import { embed } from '../embeddings.js';
import { queryMemories } from '../memory.js';

export async function handleSearchGlobal(
  db: Database.Database,
  input: { query: string; limit?: number }
) {
  const embedding = await embed(input.query);
  return queryMemories(db, { embedding, limit: Math.min(input.limit ?? 10, 50) });
}
