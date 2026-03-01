import type Database from 'better-sqlite3';
import type { MemoryType } from '../types.js';
import { embed } from '../embeddings.js';
import { queryMemories } from '../memory.js';

export async function handleRecall(
  db: Database.Database,
  input: { project_id: string; query: string; limit?: number; type?: MemoryType; agent_id?: string }
) {
  const embedding = await embed(input.query);
  return queryMemories(db, {
    embedding,
    project_id: input.project_id,
    type: input.type,
    agent_id: input.agent_id,
    limit: Math.min(input.limit ?? 10, 50),
  });
}
