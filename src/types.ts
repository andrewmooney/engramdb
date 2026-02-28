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
