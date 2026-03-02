export const version = 1;
export const sql = `
  CREATE INDEX IF NOT EXISTS idx_memories_updated_at ON memories(updated_at);
  CREATE INDEX IF NOT EXISTS idx_memories_agent_id   ON memories(agent_id);
`;
