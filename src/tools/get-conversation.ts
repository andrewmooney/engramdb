import type Database from 'better-sqlite3';
import { getConversation } from '../conversation.js';

export function handleGetConversation(
  db: Database.Database,
  input: { conversation_id: string }
) {
  if (!input.conversation_id?.trim()) throw new Error('conversation_id is required');
  const result = getConversation(db, input.conversation_id);
  if (!result) throw new Error('Conversation not found');
  return result;
}
