export type MemoryType =
  | 'fact'
  | 'code_pattern'
  | 'preference'
  | 'decision'
  | 'task'
  | 'observation';

export interface Memory {
  id: string;
  project_id: string;
  agent_id: string;
  type: MemoryType;
  content: string;
  importance: number;
  access_count: number;
  created_at: number;
  updated_at: number;
  last_accessed_at: number;
}

export interface MemoryWithScore extends Memory {
  /** Weighted composite score: 0.6×similarity + 0.25×importance + 0.15×recency. Higher is better. Range: [0, ~1]. */
  score: number;
}

export type ConversationStatus = 'open' | 'closed';
export type TurnRole = 'user' | 'assistant' | 'tool';

export interface Conversation {
  id: string;
  project_id: string;
  agent_id: string;
  title: string | null;
  summary: string | null;
  status: ConversationStatus;
  turn_count: number;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
}

export interface ConversationTurn {
  id: string;
  conversation_id: string;
  role: TurnRole;
  content: string;
  turn_index: number;
  created_at: number;
}

export interface ConversationWithScore extends Conversation {
  /** Weighted composite score: 0.6×similarity + 0.5×(hardcoded importance) + 0.15×recency. Importance is fixed at 0.5 for conversations; ENGRAMDB_W_IMP has no effect here. Higher is better. Range: [0, ~1]. */
  score: number;
}
