import type Database from 'better-sqlite3';
import { version as v1, sql as sql1 } from './001_add_indexes.js';

const MIGRATIONS: { version: number; sql: string }[] = [
  { version: v1, sql: sql1 },
];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(r => r.version)
  );

  const applyMigration = db.transaction((version: number, sql: string) => {
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, Date.now());
  });

  for (const m of MIGRATIONS) {
    if (!applied.has(m.version)) {
      applyMigration(m.version, m.sql);
    }
  }
}
