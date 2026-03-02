#!/usr/bin/env node
/**
 * One-off migration: re-embed all memories and conversation summaries with nomic task prefixes.
 *
 * Run after deploying the task-prefix change:
 *   npx tsx scripts/migrate-embeddings.ts
 *
 * Safe to re-run (idempotent — overwrites embeddings for all rows).
 */
import Database from 'better-sqlite3';
import { load } from 'sqlite-vec';
import { homedir } from 'os';
import { join } from 'path';

const DB_PATH = process.env.ENGRAMDB_DB_PATH ?? join(homedir(), '.global-agent-memory.db');

const db = new Database(DB_PATH);
load(db);
db.pragma('journal_mode = WAL');

// Dynamically import the embedder (ESM)
const { embed } = await import('../src/embeddings.js');

// --- Re-embed memories ---
const memories = db.prepare('SELECT id, content FROM memories').all() as { id: string; content: string }[];
console.log(`Re-embedding ${memories.length} memories...`);
let memDone = 0;
for (const m of memories) {
  const embedding = await embed(m.content, 'search_document: ');
  db.prepare('UPDATE memory_embeddings SET embedding = ? WHERE id = ?').run(embedding, m.id);
  memDone++;
  if (memDone % 10 === 0) process.stdout.write(`  ${memDone}/${memories.length}\n`);
}
console.log(`Memories done: ${memDone}`);

// --- Re-embed closed conversations ---
const convs = db.prepare(`SELECT id, summary FROM conversations WHERE status = 'closed' AND summary IS NOT NULL`).all() as { id: string; summary: string }[];
console.log(`Re-embedding ${convs.length} conversation summaries...`);
let convDone = 0;
for (const c of convs) {
  const embedding = await embed(c.summary, 'search_document: ');
  db.prepare('UPDATE conversation_embeddings SET embedding = ? WHERE id = ?').run(embedding, c.id);
  convDone++;
  if (convDone % 10 === 0) process.stdout.write(`  ${convDone}/${convs.length}\n`);
}
console.log(`Conversations done: ${convDone}`);

console.log('Migration complete.');
db.close();
