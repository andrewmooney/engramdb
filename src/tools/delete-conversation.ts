import type Database from 'better-sqlite3';
import { deleteConversation } from '../conversation.js';

export function handleDeleteConversation(
  db: Database.Database,
  input: { conversation_id: string }
): { deleted: boolean; conversation_id: string } {
  if (!input.conversation_id?.trim()) throw new Error('conversation_id is required');
  return deleteConversation(db, input.conversation_id);
}
