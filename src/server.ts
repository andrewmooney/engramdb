import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { handleRemember } from './tools/remember.js';
import { handleRecall } from './tools/recall.js';
import { handleSearchGlobal } from './tools/search-global.js';
import { handleUpdate } from './tools/update.js';
import { handleListProjects } from './tools/list-projects.js';

const MEMORY_TYPES = ['fact', 'code_pattern', 'preference', 'decision', 'task', 'observation'] as const;

export function createServer(db: Database.Database): McpServer {
  const server = new McpServer({ name: 'mtmem', version: '0.1.0' });

  server.tool(
    'remember_memory',
    'Store a memory about a project',
    {
      project_id: z.string().min(1),
      agent_id: z.string().min(1),
      type: z.enum(MEMORY_TYPES),
      content: z.string().min(1),
      importance: z.number().min(0).max(1).optional(),
    },
    async ({ project_id, agent_id, type, content, importance }) => {
      const result = await handleRemember(db, { project_id, agent_id, type, content, importance });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'recall_memories',
    'Semantically search memories within a project',
    {
      project_id: z.string().min(1),
      query: z.string().min(1),
      limit: z.number().int().min(1).max(50).optional(),
      type: z.enum(MEMORY_TYPES).optional(),
      agent_id: z.string().optional(),
    },
    async (input) => {
      const results = await handleRecall(db, input);
      return { content: [{ type: 'text', text: JSON.stringify(results) }] };
    }
  );

  server.tool(
    'search_global',
    'Search memories across all projects',
    {
      query: z.string().min(1),
      limit: z.number().int().min(1).max(50).optional(),
    },
    async (input) => {
      const results = await handleSearchGlobal(db, input);
      return { content: [{ type: 'text', text: JSON.stringify(results) }] };
    }
  );

  server.tool(
    'update_memory',
    'Update an existing memory by id',
    {
      id: z.string().uuid(),
      content: z.string().min(1).optional(),
      importance: z.number().min(0).max(1).optional(),
      type: z.enum(MEMORY_TYPES).optional(),
    },
    async (input) => {
      const result = await handleUpdate(db, input);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'list_projects',
    'List all projects with memory counts',
    {},
    () => {
      const result = handleListProjects(db);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  return server;
}
