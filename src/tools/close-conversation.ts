import type Database from 'better-sqlite3';
import { embedOrThrow } from '../embeddings.js';
import { closeConversation } from '../conversation.js';

export async function handleCloseConversation(
  db: Database.Database,
  input: { conversation_id: string; summary: string }
) {
  if (!input.conversation_id?.trim()) throw new Error('conversation_id is required');
  if (!input.summary?.trim()) throw new Error('summary is required');

  const embedding = await embedOrThrow(input.summary);

  closeConversation(db, { ...input, embedding });
  return { message: 'Conversation closed.' };
}
