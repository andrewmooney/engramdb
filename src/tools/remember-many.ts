import type Database from 'better-sqlite3';
import type { MemoryType } from '../types.js';
import { embedOrThrow } from '../embeddings.js';
import { upsertMemory } from '../memory.js';

interface MemoryItem {
  type: MemoryType;
  content: string;
  importance?: number;
}

export async function handleRememberMany(
  db: Database.Database,
  input: { project_id: string; agent_id: string; memories: MemoryItem[] }
): Promise<{ id: string; created_at: number }[]> {
  if (!input.project_id?.trim()) throw new Error('project_id is required');
  if (!input.agent_id?.trim()) throw new Error('agent_id is required');
  if (!input.memories?.length) throw new Error('memories must not be empty');

  const results: { id: string; created_at: number }[] = [];
  for (const item of input.memories) {
    if (!item.content?.trim()) throw new Error('each memory must have non-empty content');
    const importance = Math.max(0, Math.min(1, item.importance ?? 0.5));
    const embedding = await embedOrThrow(item.content, 'search_document: ');
    const result = upsertMemory(db, {
      project_id: input.project_id,
      agent_id: input.agent_id,
      type: item.type,
      content: item.content,
      importance,
      embedding,
    });
    results.push(result);
  }
  return results;
}
