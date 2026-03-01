import type Database from 'better-sqlite3';
import type { MemoryType } from '../types.js';
import { embed } from '../embeddings.js';
import { insertMemory } from '../memory.js';

export async function handleRemember(
  db: Database.Database,
  input: { project_id: string; agent_id: string; type: MemoryType; content: string; importance?: number }
) {
  if (!input.project_id) throw new Error('project_id is required');
  const embedding = await embed(input.content);
  return insertMemory(db, { ...input, importance: input.importance ?? 0.5, embedding });
}
