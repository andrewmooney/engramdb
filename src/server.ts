import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { handleRemember } from './tools/remember.js';
import { handleRecall } from './tools/recall.js';
import { handleSearchGlobal } from './tools/search-global.js';
import { handleUpdate } from './tools/update.js';
import { handleListProjects } from './tools/list-projects.js';
import { handleDeleteMemory } from './tools/delete-memory.js';
import { handleStartConversation } from './tools/start-conversation.js';
import { handleAppendTurn } from './tools/append-turn.js';
import { handleCloseConversation } from './tools/close-conversation.js';
import { handleGetConversation } from './tools/get-conversation.js';
import { handleSearchConversations } from './tools/search-conversations.js';

const MEMORY_TYPES = ['fact', 'code_pattern', 'preference', 'decision', 'task', 'observation'] as const;
const TURN_ROLES = ['user', 'assistant', 'tool'] as const;

export function createServer(db: Database.Database): McpServer {
  const server = new McpServer({ name: 'engramdb', version: '0.1.0' });

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
      try {
        const result = await handleRemember(db, { project_id, agent_id, type, content, importance });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
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
      try {
        const results = await handleRecall(db, input);
        return { content: [{ type: 'text', text: JSON.stringify(results) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
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
      try {
        const results = await handleSearchGlobal(db, input);
        return { content: [{ type: 'text', text: JSON.stringify(results) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
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
      try {
        if (input.content === undefined && input.importance === undefined && input.type === undefined) {
          throw new Error('At least one of content, importance, or type must be provided');
        }
        const result = await handleUpdate(db, input);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    }
  );

  server.tool(
    'list_projects',
    'List all projects with memory counts',
    {},
    () => {
      try {
        const result = handleListProjects(db);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    }
  );

  server.tool(
    'delete_memory',
    'Delete a memory by id',
    {
      id: z.string().uuid(),
    },
    (input) => {
      try {
        const result = handleDeleteMemory(db, input);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    }
  );

  server.tool(
    'start_conversation',
    'Start a new conversation session for a project',
    {
      project_id: z.string().min(1),
      agent_id: z.string().min(1),
      title: z.string().optional(),
    },
    (input) => {
      try {
        const result = handleStartConversation(db, input);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    }
  );

  server.tool(
    'append_turn',
    'Append a turn to an open conversation',
    {
      conversation_id: z.string().min(1),
      role: z.enum(TURN_ROLES),
      content: z.string().min(1),
    },
    (input) => {
      try {
        const result = handleAppendTurn(db, input);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    }
  );

  server.tool(
    'close_conversation',
    'Close a conversation and store a searchable summary',
    {
      conversation_id: z.string().min(1),
      summary: z.string().min(1),
    },
    async (input) => {
      try {
        const result = await handleCloseConversation(db, input);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    }
  );

  server.tool(
    'get_conversation',
    'Retrieve a conversation and all its turns',
    {
      conversation_id: z.string().min(1),
    },
    (input) => {
      try {
        const result = handleGetConversation(db, input);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    }
  );

  server.tool(
    'search_conversations',
    'Semantically search closed conversations by summary',
    {
      query: z.string().min(1),
      project_id: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    async (input) => {
      try {
        const results = await handleSearchConversations(db, input);
        return { content: [{ type: 'text', text: JSON.stringify(results) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    }
  );

  return server;
}
