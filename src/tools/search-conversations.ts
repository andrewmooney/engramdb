import type Database from 'better-sqlite3';
import { embed } from '../embeddings.js';
import { queryConversations } from '../conversation.js';

export async function handleSearchConversations(
  db: Database.Database,
  input: { query: string; project_id?: string; limit?: number }
) {
  if (!input.query?.trim()) throw new Error('query is required');
  const embedding = await embed(input.query).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[engramdb] Embedding failed: ${msg}`);
  });
  return queryConversations(db, {
    embedding,
    project_id: input.project_id,
    limit: Math.min(input.limit ?? 10, 50),
  });
}
