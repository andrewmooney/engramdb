import type Database from 'better-sqlite3';
import type { TurnRole } from '../types.js';
import { appendTurn } from '../conversation.js';

export function handleAppendTurn(
  db: Database.Database,
  input: { conversation_id: string; role: TurnRole; content: string }
) {
  if (!input.conversation_id?.trim()) throw new Error('conversation_id is required');
  if (!input.content?.trim()) throw new Error('content is required');
  return appendTurn(db, input);
}
