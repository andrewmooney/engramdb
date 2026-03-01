import type Database from 'better-sqlite3';
import { listProjects } from '../memory.js';

export function handleListProjects(db: Database.Database) {
  return listProjects(db);
}
