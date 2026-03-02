import type Database from 'better-sqlite3';
import type { Conversation, ConversationStatus } from '../types.js';
import { listConversations } from '../conversation.js';

export function handleListConversations(
  db: Database.Database,
  input: { project_id: string; agent_id?: string; status?: ConversationStatus; limit?: number }
): Conversation[] {
  if (!input.project_id?.trim()) throw new Error('project_id is required');
  return listConversations(db, input);
}
