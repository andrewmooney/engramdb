import type Database from 'better-sqlite3';
import type { MemoryType } from '../types.js';
import { embedOrThrow } from '../embeddings.js';
import { insertMemory } from '../memory.js';

export async function handleRemember(
  db: Database.Database,
  input: { project_id: string; agent_id: string; type: MemoryType; content: string; importance?: number }
) {
  if (!input.project_id) throw new Error('project_id is required');
  if (!input.content?.trim()) throw new Error('content is required and must not be empty');
  if (!input.agent_id?.trim()) throw new Error('agent_id is required and must not be empty');
  const importance = Math.max(0, Math.min(1, input.importance ?? 0.5));
  const embedding = await embedOrThrow(input.content, 'search_document: ');
  return insertMemory(db, { ...input, importance, embedding });
}
