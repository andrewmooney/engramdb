import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDb } from '../src/db.js';
import type Database from 'better-sqlite3';

vi.mock('../src/embeddings.js', () => ({
  embed: vi.fn().mockResolvedValue(new Float32Array(768).fill(0.1)),
  embedOrThrow: vi.fn().mockResolvedValue(new Float32Array(768).fill(0.1)),
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

describe('delete_memory tool', () => {
  it('deletes an existing memory by id', async () => {
    const { handleRemember } = await import('../src/tools/remember.js');
    const { handleDeleteMemory } = await import('../src/tools/delete-memory.js');
    const { id } = await handleRemember(db, {
      project_id: '/p', agent_id: 'a', type: 'fact', content: 'to delete', importance: 0.5,
    });
    const result = handleDeleteMemory(db, { id });
    expect(result.deleted).toBe(true);
  });

  it('throws for unknown id', async () => {
    const { handleDeleteMemory } = await import('../src/tools/delete-memory.js');
    expect(() => handleDeleteMemory(db, { id: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' }))
      .toThrow('Memory not found');
  });

  it('memory is gone after deletion', async () => {
    const { handleRemember } = await import('../src/tools/remember.js');
    const { handleDeleteMemory } = await import('../src/tools/delete-memory.js');
    const { id } = await handleRemember(db, {
      project_id: '/p', agent_id: 'a', type: 'fact', content: 'to delete', importance: 0.5,
    });
    handleDeleteMemory(db, { id });
    const row = db.prepare('SELECT id FROM memories WHERE id = ?').get(id);
    expect(row).toBeUndefined();
  });
});

describe('delete_project tool', () => {
  it('deletes all memories for a project', async () => {
    const { handleRemember } = await import('../src/tools/remember.js')
    const { handleDeleteProject } = await import('../src/tools/delete-project.js')
    const { handleListProjects } = await import('../src/tools/list-projects.js')
    const { id: id1 } = await handleRemember(db, { project_id: '/proj', agent_id: 'a', type: 'fact', content: 'mem1', importance: 0.5 })
    const { id: id2 } = await handleRemember(db, { project_id: '/proj', agent_id: 'a', type: 'fact', content: 'mem2', importance: 0.5 })
    const result = handleDeleteProject(db, { project_id: '/proj' })
    expect(result.deleted_count).toBe(2)
    const projects = handleListProjects(db)
    expect(projects).toHaveLength(0)
    const embRows = db.prepare('SELECT id FROM memory_embeddings WHERE id IN (?, ?)').all(id1, id2)
    expect(embRows).toHaveLength(0)
  })

  it('returns 0 deleted_count for unknown project', async () => {
    const { handleDeleteProject } = await import('../src/tools/delete-project.js')
    const result = handleDeleteProject(db, { project_id: '/nonexistent' })
    expect(result.deleted_count).toBe(0)
  })

  it('only deletes memories for specified project', async () => {
    const { handleRemember } = await import('../src/tools/remember.js')
    const { handleDeleteProject } = await import('../src/tools/delete-project.js')
    const { handleListProjects } = await import('../src/tools/list-projects.js')
    await handleRemember(db, { project_id: '/projA', agent_id: 'a', type: 'fact', content: 'mem A', importance: 0.5 })
    await handleRemember(db, { project_id: '/projB', agent_id: 'a', type: 'fact', content: 'mem B', importance: 0.5 })
    handleDeleteProject(db, { project_id: '/projA' })
    const projects = handleListProjects(db)
    expect(projects).toHaveLength(1)
    expect(projects[0].project_id).toBe('/projB')
  })
})

describe('remember_memory deduplication (upsert)', () => {
  it('returns the same id for identical content in the same project', async () => {
    const { handleRemember } = await import('../src/tools/remember.js');
    const r1 = await handleRemember(db, { project_id: '/p', agent_id: 'a', type: 'fact', content: 'exact same', importance: 0.5 });
    const r2 = await handleRemember(db, { project_id: '/p', agent_id: 'a', type: 'fact', content: 'exact same', importance: 0.8 });
    expect(r1.id).toBe(r2.id);
  });

  it('updates importance when upserting', async () => {
    const { handleRemember } = await import('../src/tools/remember.js');
    const { handleListMemories } = await import('../src/tools/list-memories.js');
    await handleRemember(db, { project_id: '/p', agent_id: 'a', type: 'fact', content: 'dedup test', importance: 0.3 });
    await handleRemember(db, { project_id: '/p', agent_id: 'a', type: 'fact', content: 'dedup test', importance: 0.9 });
    const mems = handleListMemories(db, { project_id: '/p' });
    expect(mems).toHaveLength(1);
    expect(mems[0].importance).toBeCloseTo(0.9);
  });

  it('allows same content in different projects', async () => {
    const { handleRemember } = await import('../src/tools/remember.js');
    const { handleListProjects } = await import('../src/tools/list-projects.js');
    await handleRemember(db, { project_id: '/projA', agent_id: 'a', type: 'fact', content: 'shared fact', importance: 0.5 });
    await handleRemember(db, { project_id: '/projB', agent_id: 'a', type: 'fact', content: 'shared fact', importance: 0.5 });
    const projects = handleListProjects(db);
    expect(projects).toHaveLength(2);
  });
});

describe('get_memory tool', () => {
  it('returns the memory for a known id', async () => {
    const { handleRemember } = await import('../src/tools/remember.js');
    const { handleGetMemory } = await import('../src/tools/get-memory.js');
    const { id } = await handleRemember(db, { project_id: '/p', agent_id: 'a', type: 'fact', content: 'fetchable', importance: 0.6 });
    const result = handleGetMemory(db, { id });
    expect(result.found).toBe(true);
    expect(result.memory?.content).toBe('fetchable');
  });

  it('returns { found: false } for an unknown id', async () => {
    const { handleGetMemory } = await import('../src/tools/get-memory.js');
    const result = handleGetMemory(db, { id: '00000000-0000-0000-0000-000000000000' });
    expect(result.found).toBe(false);
    expect(result.memory).toBeUndefined();
  });
});

describe('list_memories tool', () => {
  it('lists all memories for a project', async () => {
    const { handleRemember } = await import('../src/tools/remember.js')
    const { handleListMemories } = await import('../src/tools/list-memories.js')
    await handleRemember(db, { project_id: '/p', agent_id: 'a', type: 'fact', content: 'mem1', importance: 0.5 })
    await handleRemember(db, { project_id: '/p', agent_id: 'a', type: 'decision', content: 'mem2', importance: 0.8 })
    const results = handleListMemories(db, { project_id: '/p' })
    expect(results).toHaveLength(2)
  })

  it('filters by type', async () => {
    const { handleRemember } = await import('../src/tools/remember.js')
    const { handleListMemories } = await import('../src/tools/list-memories.js')
    await handleRemember(db, { project_id: '/p', agent_id: 'a', type: 'fact', content: 'mem1', importance: 0.5 })
    await handleRemember(db, { project_id: '/p', agent_id: 'a', type: 'decision', content: 'mem2', importance: 0.8 })
    const results = handleListMemories(db, { project_id: '/p', type: 'fact' })
    expect(results).toHaveLength(1)
    expect(results[0].type).toBe('fact')
  })

  it('returns empty array for unknown project', async () => {
    const { handleListMemories } = await import('../src/tools/list-memories.js')
    const results = handleListMemories(db, { project_id: '/nonexistent' })
    expect(results).toHaveLength(0)
  })

  it('respects the limit parameter', async () => {
    const { handleRemember } = await import('../src/tools/remember.js')
    const { handleListMemories } = await import('../src/tools/list-memories.js')
    await handleRemember(db, { project_id: '/p', agent_id: 'a', type: 'fact', content: 'mem1', importance: 0.5 })
    await handleRemember(db, { project_id: '/p', agent_id: 'a', type: 'fact', content: 'mem2', importance: 0.5 })
    await handleRemember(db, { project_id: '/p', agent_id: 'a', type: 'fact', content: 'mem3', importance: 0.5 })
    const results = handleListMemories(db, { project_id: '/p', limit: 2 })
    expect(results).toHaveLength(2)
  })
})
