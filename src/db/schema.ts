import Database from "better-sqlite3";

type DB = InstanceType<typeof Database>;

export function initializeSchema(db: DB): void {
	db.exec(`
    CREATE TABLE IF NOT EXISTS task_groups (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES task_groups(id),
      sequence INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      priority TEXT NOT NULL DEFAULT 'medium',
      assigned_to TEXT,
      branch_name TEXT,
      worktree_path TEXT,
      progress INTEGER NOT NULL DEFAULT 0,
      progress_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT,
      merged_at TEXT
    );

    CREATE TABLE IF NOT EXISTS task_dependencies (
      task_id TEXT NOT NULL REFERENCES tasks(id),
      depends_on TEXT NOT NULL REFERENCES tasks(id),
      PRIMARY KEY (task_id, depends_on)
    );

    CREATE TABLE IF NOT EXISTS task_file_ownership (
      task_id TEXT NOT NULL REFERENCES tasks(id),
      file_pattern TEXT NOT NULL,
      ownership_type TEXT NOT NULL DEFAULT 'exclusive',
      PRIMARY KEY (task_id, file_pattern)
    );

    CREATE TABLE IF NOT EXISTS progress_logs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      event TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_group ON tasks(group_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_deps_task ON task_dependencies(task_id);
    CREATE INDEX IF NOT EXISTS idx_deps_depends ON task_dependencies(depends_on);
    CREATE INDEX IF NOT EXISTS idx_logs_task ON progress_logs(task_id);
  `);
}
