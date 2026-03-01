import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDb } from '../src/db.js';
import type Database from 'better-sqlite3';

vi.mock('../src/embeddings.js', () => ({
  embed: vi.fn().mockResolvedValue(new Float32Array(768).fill(0.1)),
}));

let db: Database.Database;

beforeEach(() => {
  db = createDb(':memory:');
});

describe('remember_memory tool', () => {
  it('stores a memory and returns id + created_at', async () => {
    const { handleRemember } = await import('../src/tools/remember.js');
    const result = await handleRemember(db, {
      project_id: '/home/user/myproject',
      agent_id: 'opencode',
      type: 'fact',
      content: 'Uses React with TypeScript',
      importance: 0.8,
    });
    expect(result.id).toBeTruthy();
    expect(result.created_at).toBeGreaterThan(0);
  });

  it('throws for empty project_id', async () => {
    const { handleRemember } = await import('../src/tools/remember.js');
    await expect(
      handleRemember(db, { project_id: '', agent_id: 'opencode', type: 'fact', content: 'test', importance: 0.5 })
    ).rejects.toThrow();
  });

  it('throws for empty content', async () => {
    const { handleRemember } = await import('../src/tools/remember.js');
    await expect(
      handleRemember(db, { project_id: '/p', agent_id: 'a', type: 'fact', content: '', importance: 0.5 })
    ).rejects.toThrow();
  });
});

describe('recall_memories tool', () => {
  it('returns memories scored and sorted', async () => {
    const { handleRemember } = await import('../src/tools/remember.js');
    const { handleRecall } = await import('../src/tools/recall.js');
    await handleRemember(db, {
      project_id: '/home/user/myproject',
      agent_id: 'opencode',
      type: 'fact',
      content: 'Uses React with TypeScript',
      importance: 0.8,
    });
    const results = await handleRecall(db, {
      project_id: '/home/user/myproject',
      query: 'React TypeScript',
      limit: 5,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('score');
  });

  it('throws for empty query', async () => {
    const { handleRecall } = await import('../src/tools/recall.js');
    await expect(handleRecall(db, { project_id: '/p', query: '' })).rejects.toThrow();
  });
});

describe('search_global tool', () => {
  it('searches across all projects', async () => {
    const { handleRemember } = await import('../src/tools/remember.js');
    const { handleSearchGlobal } = await import('../src/tools/search-global.js');
    await handleRemember(db, {
      project_id: '/home/user/projectA',
      agent_id: 'opencode',
      type: 'fact',
      content: 'Project A uses Express',
      importance: 0.6,
    });
    const results = await handleSearchGlobal(db, { query: 'Express', limit: 5 });
    expect(results.length).toBeGreaterThan(0);
  });

  it('throws for empty query', async () => {
    const { handleSearchGlobal } = await import('../src/tools/search-global.js');
    await expect(handleSearchGlobal(db, { query: '' })).rejects.toThrow();
  });
});

describe('update_memory tool', () => {
  it('throws for unknown id', async () => {
    const { handleUpdate } = await import('../src/tools/update.js');
    await expect(
      handleUpdate(db, { id: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', importance: 0.9 })
    ).rejects.toThrow();
  });

  it('updates importance', async () => {
    const { handleRemember } = await import('../src/tools/remember.js');
    const { handleUpdate } = await import('../src/tools/update.js');
    const { id } = await handleRemember(db, {
      project_id: '/p',
      agent_id: 'a',
      type: 'fact',
      content: 'test',
      importance: 0.3,
    });
    const result = await handleUpdate(db, { id, importance: 0.9 });
    expect(result.id).toBe(id);
    expect(result.updated_at).toBeGreaterThan(0);
  });
});

describe('list_projects tool', () => {
  it('lists projects with counts', async () => {
    const { handleRemember } = await import('../src/tools/remember.js');
    const { handleListProjects } = await import('../src/tools/list-projects.js');
    await handleRemember(db, {
      project_id: '/home/user/myproject',
      agent_id: 'opencode',
      type: 'fact',
      content: 'test',
      importance: 0.5,
    });
    const projects = handleListProjects(db);
    expect(projects).toHaveLength(1);
    expect(projects[0].project_id).toBe('/home/user/myproject');
    expect(projects[0].memory_count).toBe(1);
  });
});
