import type Database from 'better-sqlite3';
import { deleteProject } from '../memory.js';

export function handleDeleteProject(
  db: Database.Database,
  input: { project_id: string }
): { deleted_count: number; project_id: string } {
  return deleteProject(db, input.project_id);
}
