import Database from "better-sqlite3";
import type {
	Task,
	TaskGroup,
	TaskFileOwnership,
	ProgressLog,
} from "../types/index.js";

type DB = InstanceType<typeof Database>;

export class TaskQueries {
	private db: DB;

	constructor(db: DB) {
		this.db = db;
	}

	// ── Task Groups ──────────────────────────────────────────────────

	createGroup(group: Omit<TaskGroup, "created_at">): TaskGroup {
		const stmt = this.db.prepare(`
      INSERT INTO task_groups (id, title, description, status)
      VALUES (@id, @title, @description, @status)
    `);
		stmt.run(group);
		return this.getGroup(group.id)!;
	}

	getGroup(id: string): TaskGroup | undefined {
		const stmt = this.db.prepare(`
      SELECT id, title, description, status, created_at
      FROM task_groups WHERE id = ?
    `);
		return stmt.get(id) as TaskGroup | undefined;
	}

	// ── Tasks ────────────────────────────────────────────────────────

	createTask(
		task: Omit<
			Task,
			"created_at" | "started_at" | "completed_at" | "merged_at"
		>,
	): Task {
		const stmt = this.db.prepare(`
      INSERT INTO tasks (id, group_id, sequence, title, description, status, priority,
                         assigned_to, branch_name, worktree_path, progress, progress_note)
      VALUES (@id, @group_id, @sequence, @title, @description, @status, @priority,
              @assigned_to, @branch_name, @worktree_path, @progress, @progress_note)
    `);
		stmt.run({
			id: task.id,
			group_id: task.group_id,
			sequence: task.sequence,
			title: task.title,
			description: task.description,
			status: task.status,
			priority: task.priority,
			assigned_to: task.assigned_to ?? null,
			branch_name: task.branch_name ?? null,
			worktree_path: task.worktree_path ?? null,
			progress: task.progress,
			progress_note: task.progress_note ?? null,
		});
		return this.getTask(task.id)!;
	}

	getTask(id: string): Task | undefined {
		const stmt = this.db.prepare(`
      SELECT id, group_id, sequence, title, description, status, priority,
             assigned_to, branch_name, worktree_path, progress, progress_note,
             created_at, started_at, completed_at, merged_at
      FROM tasks WHERE id = ?
    `);
		return stmt.get(id) as Task | undefined;
	}

	getTaskBySequenceAndGroup(
		groupId: string,
		sequence: number,
	): Task | undefined {
		const stmt = this.db.prepare(`
      SELECT id, group_id, sequence, title, description, status, priority,
             assigned_to, branch_name, worktree_path, progress, progress_note,
             created_at, started_at, completed_at, merged_at
      FROM tasks WHERE group_id = ? AND sequence = ?
    `);
		return stmt.get(groupId, sequence) as Task | undefined;
	}

	listTasks(opts?: { group_id?: string; status?: string[] }): Task[] {
		let sql = `
      SELECT id, group_id, sequence, title, description, status, priority,
             assigned_to, branch_name, worktree_path, progress, progress_note,
             created_at, started_at, completed_at, merged_at
      FROM tasks
    `;
		const conditions: string[] = [];
		const params: unknown[] = [];

		if (opts?.group_id) {
			conditions.push("group_id = ?");
			params.push(opts.group_id);
		}

		if (opts?.status && opts.status.length > 0) {
			const placeholders = opts.status.map(() => "?").join(", ");
			conditions.push(`status IN (${placeholders})`);
			params.push(...opts.status);
		}

		if (conditions.length > 0) {
			sql += " WHERE " + conditions.join(" AND ");
		}

		sql += " ORDER BY sequence ASC";

		const stmt = this.db.prepare(sql);
		return stmt.all(...params) as Task[];
	}

	updateTask(
		id: string,
		updates: Partial<
			Pick<
				Task,
				| "status"
				| "assigned_to"
				| "branch_name"
				| "worktree_path"
				| "progress"
				| "progress_note"
				| "started_at"
				| "completed_at"
				| "merged_at"
			>
		>,
	): Task {
		const keys = Object.keys(updates).filter(
			(k) => (updates as Record<string, unknown>)[k] !== undefined,
		);

		if (keys.length === 0) {
			return this.getTask(id)!;
		}

		const setClauses = keys.map((k) => `${k} = @${k}`).join(", ");
		const sql = `UPDATE tasks SET ${setClauses} WHERE id = @id`;
		const stmt = this.db.prepare(sql);
		stmt.run({ id, ...updates });
		return this.getTask(id)!;
	}

	// ── Dependencies ─────────────────────────────────────────────────

	addDependency(taskId: string, dependsOn: string): void {
		const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO task_dependencies (task_id, depends_on)
      VALUES (?, ?)
    `);
		stmt.run(taskId, dependsOn);
	}

	getDependencies(taskId: string): Task[] {
		const stmt = this.db.prepare(`
      SELECT t.id, t.group_id, t.sequence, t.title, t.description, t.status,
             t.priority, t.assigned_to, t.branch_name, t.worktree_path,
             t.progress, t.progress_note, t.created_at, t.started_at,
             t.completed_at, t.merged_at
      FROM task_dependencies d
      JOIN tasks t ON t.id = d.depends_on
      WHERE d.task_id = ?
      ORDER BY t.sequence ASC
    `);
		return stmt.all(taskId) as Task[];
	}

	getDependents(taskId: string): Task[] {
		const stmt = this.db.prepare(`
      SELECT t.id, t.group_id, t.sequence, t.title, t.description, t.status,
             t.priority, t.assigned_to, t.branch_name, t.worktree_path,
             t.progress, t.progress_note, t.created_at, t.started_at,
             t.completed_at, t.merged_at
      FROM task_dependencies d
      JOIN tasks t ON t.id = d.task_id
      WHERE d.depends_on = ?
      ORDER BY t.sequence ASC
    `);
		return stmt.all(taskId) as Task[];
	}

	// ── File Ownership ───────────────────────────────────────────────

	addFileOwnership(ownership: TaskFileOwnership): void {
		const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO task_file_ownership (task_id, file_pattern, ownership_type)
      VALUES (@task_id, @file_pattern, @ownership_type)
    `);
		stmt.run(ownership);
	}

	getFileOwnership(taskId: string): TaskFileOwnership[] {
		const stmt = this.db.prepare(`
      SELECT task_id, file_pattern, ownership_type
      FROM task_file_ownership WHERE task_id = ?
    `);
		return stmt.all(taskId) as TaskFileOwnership[];
	}

	getFileOwnershipConflicts(
		taskId: string,
	): Array<{ task: Task; pattern: string; ownership_type: string }> {
		// Find in_progress tasks whose file patterns overlap with this task's patterns.
		// Two patterns "overlap" when they are identical strings. The conflict applies
		// when the other task is currently in_progress and has a matching pattern.
		const stmt = this.db.prepare(`
      SELECT t.id, t.group_id, t.sequence, t.title, t.description, t.status,
             t.priority, t.assigned_to, t.branch_name, t.worktree_path,
             t.progress, t.progress_note, t.created_at, t.started_at,
             t.completed_at, t.merged_at,
             other_fo.file_pattern AS pattern,
             other_fo.ownership_type AS ownership_type
      FROM task_file_ownership my_fo
      JOIN task_file_ownership other_fo ON my_fo.file_pattern = other_fo.file_pattern
      JOIN tasks t ON t.id = other_fo.task_id
      WHERE my_fo.task_id = ?
        AND other_fo.task_id != ?
        AND t.status = 'in_progress'
    `);

		const rows = stmt.all(taskId, taskId) as Array<
			Task & { pattern: string; ownership_type: string }
		>;

		return rows.map((row) => {
			const { pattern, ownership_type, ...taskFields } = row;
			return {
				task: taskFields as Task,
				pattern,
				ownership_type,
			};
		});
	}

	// ── Progress Logs ────────────────────────────────────────────────

	addProgressLog(log: Omit<ProgressLog, "timestamp">): ProgressLog {
		const stmt = this.db.prepare(`
      INSERT INTO progress_logs (id, task_id, event, message, metadata)
      VALUES (@id, @task_id, @event, @message, @metadata)
    `);
		stmt.run({
			id: log.id,
			task_id: log.task_id,
			event: log.event,
			message: log.message,
			metadata: log.metadata ? JSON.stringify(log.metadata) : null,
		});
		return this.getProgressLog(log.id)!;
	}

	getProgressLogs(taskId: string): ProgressLog[] {
		const stmt = this.db.prepare(`
      SELECT id, task_id, timestamp, event, message, metadata
      FROM progress_logs WHERE task_id = ?
      ORDER BY timestamp ASC
    `);
		const rows = stmt.all(taskId) as Array<
			Omit<ProgressLog, "metadata"> & { metadata: string | null }
		>;
		return rows.map((row) => ({
			...row,
			metadata: row.metadata ? JSON.parse(row.metadata) : null,
		}));
	}

	// ── Private helpers ──────────────────────────────────────────────

	private getProgressLog(id: string): ProgressLog | undefined {
		const stmt = this.db.prepare(`
      SELECT id, task_id, timestamp, event, message, metadata
      FROM progress_logs WHERE id = ?
    `);
		const row = stmt.get(id) as
			| (Omit<ProgressLog, "metadata"> & { metadata: string | null })
			| undefined;
		if (!row) return undefined;
		return {
			...row,
			metadata: row.metadata ? JSON.parse(row.metadata) : null,
		};
	}
}
