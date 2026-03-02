import type Database from 'better-sqlite3';
import { embedOrThrow } from '../embeddings.js';
import { queryMemories } from '../memory.js';

export async function handleSearchGlobal(
  db: Database.Database,
  input: { query: string; limit?: number }
) {
  if (!input.query?.trim()) throw new Error('query is required and must not be empty');
  const embedding = await embedOrThrow(input.query, 'search_query: ');
  return queryMemories(db, { embedding, limit: Math.min(input.limit ?? 10, 50) });
}
