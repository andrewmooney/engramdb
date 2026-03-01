import type Database from 'better-sqlite3';
import { insertConversation } from '../conversation.js';

export function handleStartConversation(
  db: Database.Database,
  input: { project_id: string; agent_id: string; title?: string }
) {
  if (!input.project_id?.trim()) throw new Error('project_id is required');
  if (!input.agent_id?.trim()) throw new Error('agent_id is required');
  return insertConversation(db, input);
}
