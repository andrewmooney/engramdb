import type Database from 'better-sqlite3';
import type { MemoryType } from '../types.js';
import { embedOrThrow } from '../embeddings.js';
import { queryMemories } from '../memory.js';

export async function handleRecall(
  db: Database.Database,
  input: { project_id: string; query: string; limit?: number; type?: MemoryType; agent_id?: string }
) {
  if (!input.query?.trim()) throw new Error('query is required and must not be empty');
  const embedding = await embedOrThrow(input.query, 'search_query: ');
  return queryMemories(db, {
    embedding,
    project_id: input.project_id,
    type: input.type,
    agent_id: input.agent_id,
    limit: Math.min(input.limit ?? 10, 50),
  });
}
