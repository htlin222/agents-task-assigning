import { describe, it, expect, beforeEach } from "vitest";
import { getDbForTesting } from "../../src/db/connection.js";
import { TaskQueries } from "../../src/db/queries.js";
import { v4 as uuidv4 } from "uuid";
import type {
	TaskGroup,
	Task,
	TaskFileOwnership,
	TaskStatus,
	TaskPriority,
	ProgressEvent,
} from "../../src/types/index.js";

// ── Helpers ──────────────────────────────────────────────────────────

function createTestGroup(
	overrides: Partial<Omit<TaskGroup, "created_at">> = {},
): Omit<TaskGroup, "created_at"> {
	return {
		id: uuidv4(),
		title: "Test Group",
		description: "A group for testing",
		status: "active",
		...overrides,
	};
}

function createTestTask(
	groupId: string,
	overrides: Partial<
		Omit<Task, "created_at" | "started_at" | "completed_at" | "merged_at">
	> = {},
): Omit<Task, "created_at" | "started_at" | "completed_at" | "merged_at"> {
	return {
		id: uuidv4(),
		group_id: groupId,
		sequence: 1,
		title: "Test Task",
		description: "A task for testing",
		status: "pending",
		priority: "medium",
		assigned_to: null,
		branch_name: null,
		worktree_path: null,
		progress: 0,
		progress_note: null,
		...overrides,
	};
}

// ── Test Suite ───────────────────────────────────────────────────────

let queries: TaskQueries;

beforeEach(() => {
	const db = getDbForTesting();
	queries = new TaskQueries(db);
});

// ── Task Groups ─────────────────────────────────────────────────────

describe("Task Groups", () => {
	it("should create a group and retrieve it", () => {
		const input = createTestGroup({ title: "My Group", description: "desc" });
		const created = queries.createGroup(input);

		expect(created.id).toBe(input.id);
		expect(created.title).toBe("My Group");
		expect(created.description).toBe("desc");
		expect(created.status).toBe("active");
		expect(created.created_at).toBeDefined();

		const fetched = queries.getGroup(input.id);
		expect(fetched).toEqual(created);
	});

	it("should return undefined for a non-existent group", () => {
		const result = queries.getGroup(uuidv4());
		expect(result).toBeUndefined();
	});
});

// ── Tasks ───────────────────────────────────────────────────────────

describe("Tasks", () => {
	let groupId: string;

	beforeEach(() => {
		const group = createTestGroup();
		queries.createGroup(group);
		groupId = group.id;
	});

	it("should create a task and retrieve it", () => {
		const input = createTestTask(groupId, {
			title: "Implement feature X",
			priority: "high",
		});
		const created = queries.createTask(input);

		expect(created.id).toBe(input.id);
		expect(created.group_id).toBe(groupId);
		expect(created.title).toBe("Implement feature X");
		expect(created.priority).toBe("high");
		expect(created.status).toBe("pending");
		expect(created.progress).toBe(0);
		expect(created.created_at).toBeDefined();
		expect(created.started_at).toBeNull();
		expect(created.completed_at).toBeNull();
		expect(created.merged_at).toBeNull();

		const fetched = queries.getTask(input.id);
		expect(fetched).toEqual(created);
	});

	it("should get a task by sequence and group", () => {
		const input = createTestTask(groupId, { sequence: 3 });
		queries.createTask(input);

		const fetched = queries.getTaskBySequenceAndGroup(groupId, 3);
		expect(fetched).toBeDefined();
		expect(fetched!.id).toBe(input.id);
		expect(fetched!.sequence).toBe(3);
	});

	it("should list all tasks (no filter)", () => {
		queries.createTask(createTestTask(groupId, { sequence: 1, title: "A" }));
		queries.createTask(createTestTask(groupId, { sequence: 2, title: "B" }));
		queries.createTask(createTestTask(groupId, { sequence: 3, title: "C" }));

		const tasks = queries.listTasks();
		expect(tasks).toHaveLength(3);
		// Verify ordering by sequence
		expect(tasks[0].title).toBe("A");
		expect(tasks[1].title).toBe("B");
		expect(tasks[2].title).toBe("C");
	});

	it("should list tasks filtered by group_id", () => {
		const otherGroup = createTestGroup();
		queries.createGroup(otherGroup);

		queries.createTask(
			createTestTask(groupId, { sequence: 1, title: "G1-T1" }),
		);
		queries.createTask(
			createTestTask(otherGroup.id, { sequence: 1, title: "G2-T1" }),
		);

		const tasksGroup1 = queries.listTasks({ group_id: groupId });
		expect(tasksGroup1).toHaveLength(1);
		expect(tasksGroup1[0].title).toBe("G1-T1");

		const tasksGroup2 = queries.listTasks({ group_id: otherGroup.id });
		expect(tasksGroup2).toHaveLength(1);
		expect(tasksGroup2[0].title).toBe("G2-T1");
	});

	it("should list tasks filtered by status", () => {
		queries.createTask(
			createTestTask(groupId, { sequence: 1, status: "pending" }),
		);
		queries.createTask(
			createTestTask(groupId, { sequence: 2, status: "in_progress" }),
		);
		queries.createTask(
			createTestTask(groupId, { sequence: 3, status: "completed" }),
		);

		const pending = queries.listTasks({ status: ["pending"] });
		expect(pending).toHaveLength(1);
		expect(pending[0].status).toBe("pending");

		const active = queries.listTasks({ status: ["pending", "in_progress"] });
		expect(active).toHaveLength(2);
	});

	it("should list tasks filtered by both group_id and status", () => {
		const otherGroup = createTestGroup();
		queries.createGroup(otherGroup);

		queries.createTask(
			createTestTask(groupId, { sequence: 1, status: "pending" }),
		);
		queries.createTask(
			createTestTask(groupId, { sequence: 2, status: "in_progress" }),
		);
		queries.createTask(
			createTestTask(otherGroup.id, { sequence: 1, status: "pending" }),
		);

		const result = queries.listTasks({
			group_id: groupId,
			status: ["pending"],
		});
		expect(result).toHaveLength(1);
		expect(result[0].group_id).toBe(groupId);
		expect(result[0].status).toBe("pending");
	});

	it("should update a task status", () => {
		const input = createTestTask(groupId);
		queries.createTask(input);

		const updated = queries.updateTask(input.id, { status: "in_progress" });
		expect(updated.status).toBe("in_progress");

		const fetched = queries.getTask(input.id);
		expect(fetched!.status).toBe("in_progress");
	});

	it("should update multiple fields at once", () => {
		const input = createTestTask(groupId);
		queries.createTask(input);

		const now = new Date().toISOString();
		const updated = queries.updateTask(input.id, {
			status: "in_progress",
			assigned_to: "agent-1",
			branch_name: "feat/task-1",
			worktree_path: "/tmp/worktree-1",
			progress: 50,
			progress_note: "Halfway done",
			started_at: now,
		});

		expect(updated.status).toBe("in_progress");
		expect(updated.assigned_to).toBe("agent-1");
		expect(updated.branch_name).toBe("feat/task-1");
		expect(updated.worktree_path).toBe("/tmp/worktree-1");
		expect(updated.progress).toBe(50);
		expect(updated.progress_note).toBe("Halfway done");
		expect(updated.started_at).toBe(now);
	});

	it("should return unchanged task when updating with empty object", () => {
		const input = createTestTask(groupId, { title: "Unchanged" });
		const created = queries.createTask(input);

		const updated = queries.updateTask(input.id, {});
		expect(updated).toEqual(created);
	});
});

// ── Dependencies ────────────────────────────────────────────────────

describe("Dependencies", () => {
	let groupId: string;

	beforeEach(() => {
		const group = createTestGroup();
		queries.createGroup(group);
		groupId = group.id;
	});

	it("should add a dependency and retrieve it", () => {
		const taskA = createTestTask(groupId, { sequence: 1, title: "Task A" });
		const taskB = createTestTask(groupId, { sequence: 2, title: "Task B" });
		queries.createTask(taskA);
		queries.createTask(taskB);

		// Task B depends on Task A
		queries.addDependency(taskB.id, taskA.id);

		const deps = queries.getDependencies(taskB.id);
		expect(deps).toHaveLength(1);
		expect(deps[0].id).toBe(taskA.id);
		expect(deps[0].title).toBe("Task A");
	});

	it("should get dependencies as full task objects", () => {
		const taskA = createTestTask(groupId, { sequence: 1, title: "Task A" });
		const taskB = createTestTask(groupId, { sequence: 2, title: "Task B" });
		const taskC = createTestTask(groupId, { sequence: 3, title: "Task C" });
		queries.createTask(taskA);
		queries.createTask(taskB);
		queries.createTask(taskC);

		// Task C depends on both A and B
		queries.addDependency(taskC.id, taskA.id);
		queries.addDependency(taskC.id, taskB.id);

		const deps = queries.getDependencies(taskC.id);
		expect(deps).toHaveLength(2);
		// Ordered by sequence ASC
		expect(deps[0].title).toBe("Task A");
		expect(deps[1].title).toBe("Task B");
		// Each is a full task object
		expect(deps[0]).toHaveProperty("id");
		expect(deps[0]).toHaveProperty("group_id");
		expect(deps[0]).toHaveProperty("status");
		expect(deps[0]).toHaveProperty("created_at");
	});

	it("should get dependents (tasks that depend on this one)", () => {
		const taskA = createTestTask(groupId, { sequence: 1, title: "Task A" });
		const taskB = createTestTask(groupId, { sequence: 2, title: "Task B" });
		const taskC = createTestTask(groupId, { sequence: 3, title: "Task C" });
		queries.createTask(taskA);
		queries.createTask(taskB);
		queries.createTask(taskC);

		// B and C both depend on A
		queries.addDependency(taskB.id, taskA.id);
		queries.addDependency(taskC.id, taskA.id);

		const dependents = queries.getDependents(taskA.id);
		expect(dependents).toHaveLength(2);
		expect(dependents[0].title).toBe("Task B");
		expect(dependents[1].title).toBe("Task C");
	});

	it("should return empty array when no dependencies exist", () => {
		const task = createTestTask(groupId);
		queries.createTask(task);

		const deps = queries.getDependencies(task.id);
		expect(deps).toEqual([]);

		const dependents = queries.getDependents(task.id);
		expect(dependents).toEqual([]);
	});
});

// ── File Ownership ──────────────────────────────────────────────────

describe("File Ownership", () => {
	let groupId: string;

	beforeEach(() => {
		const group = createTestGroup();
		queries.createGroup(group);
		groupId = group.id;
	});

	it("should add file ownership and retrieve it", () => {
		const task = createTestTask(groupId);
		queries.createTask(task);

		const ownership: TaskFileOwnership = {
			task_id: task.id,
			file_pattern: "src/db/**",
			ownership_type: "exclusive",
		};
		queries.addFileOwnership(ownership);

		const result = queries.getFileOwnership(task.id);
		expect(result).toHaveLength(1);
		expect(result[0].task_id).toBe(task.id);
		expect(result[0].file_pattern).toBe("src/db/**");
		expect(result[0].ownership_type).toBe("exclusive");
	});

	it("should detect conflicts with in_progress tasks", () => {
		const taskA = createTestTask(groupId, {
			sequence: 1,
			status: "in_progress",
		});
		const taskB = createTestTask(groupId, { sequence: 2, status: "pending" });
		queries.createTask(taskA);
		queries.createTask(taskB);

		// Both claim the same pattern
		queries.addFileOwnership({
			task_id: taskA.id,
			file_pattern: "src/db/**",
			ownership_type: "exclusive",
		});
		queries.addFileOwnership({
			task_id: taskB.id,
			file_pattern: "src/db/**",
			ownership_type: "exclusive",
		});

		const conflicts = queries.getFileOwnershipConflicts(taskB.id);
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0].task.id).toBe(taskA.id);
		expect(conflicts[0].pattern).toBe("src/db/**");
		expect(conflicts[0].ownership_type).toBe("exclusive");
	});

	it("should report no conflicts when no overlapping patterns", () => {
		const taskA = createTestTask(groupId, {
			sequence: 1,
			status: "in_progress",
		});
		const taskB = createTestTask(groupId, { sequence: 2, status: "pending" });
		queries.createTask(taskA);
		queries.createTask(taskB);

		queries.addFileOwnership({
			task_id: taskA.id,
			file_pattern: "src/api/**",
			ownership_type: "exclusive",
		});
		queries.addFileOwnership({
			task_id: taskB.id,
			file_pattern: "src/db/**",
			ownership_type: "exclusive",
		});

		const conflicts = queries.getFileOwnershipConflicts(taskB.id);
		expect(conflicts).toEqual([]);
	});

	it("should report no conflicts when other tasks are not in_progress", () => {
		const taskA = createTestTask(groupId, {
			sequence: 1,
			status: "completed",
		});
		const taskB = createTestTask(groupId, { sequence: 2, status: "pending" });
		queries.createTask(taskA);
		queries.createTask(taskB);

		// Same pattern but taskA is completed, not in_progress
		queries.addFileOwnership({
			task_id: taskA.id,
			file_pattern: "src/db/**",
			ownership_type: "exclusive",
		});
		queries.addFileOwnership({
			task_id: taskB.id,
			file_pattern: "src/db/**",
			ownership_type: "exclusive",
		});

		const conflicts = queries.getFileOwnershipConflicts(taskB.id);
		expect(conflicts).toEqual([]);
	});
});

// ── Progress Logs ───────────────────────────────────────────────────

describe("Progress Logs", () => {
	let groupId: string;
	let taskId: string;

	beforeEach(() => {
		const group = createTestGroup();
		queries.createGroup(group);
		groupId = group.id;

		const task = createTestTask(group.id);
		queries.createTask(task);
		taskId = task.id;
	});

	it("should add a progress log and retrieve it", () => {
		const logId = uuidv4();
		const log = queries.addProgressLog({
			id: logId,
			task_id: taskId,
			event: "started" as ProgressEvent,
			message: "Task has started",
			metadata: null,
		});

		expect(log.id).toBe(logId);
		expect(log.task_id).toBe(taskId);
		expect(log.event).toBe("started");
		expect(log.message).toBe("Task has started");
		expect(log.timestamp).toBeDefined();

		const logs = queries.getProgressLogs(taskId);
		expect(logs).toHaveLength(1);
		expect(logs[0].id).toBe(logId);
	});

	it("should properly serialize and deserialize metadata (JSON)", () => {
		const metadata = {
			files_changed: ["src/foo.ts", "src/bar.ts"],
			lines_added: 42,
			nested: { key: "value" },
		};

		const logId = uuidv4();
		queries.addProgressLog({
			id: logId,
			task_id: taskId,
			event: "progress_update" as ProgressEvent,
			message: "Updated files",
			metadata,
		});

		const logs = queries.getProgressLogs(taskId);
		expect(logs).toHaveLength(1);
		expect(logs[0].metadata).toEqual(metadata);
		expect(logs[0].metadata!.files_changed).toEqual([
			"src/foo.ts",
			"src/bar.ts",
		]);
		expect(logs[0].metadata!.lines_added).toBe(42);
		expect((logs[0].metadata!.nested as Record<string, unknown>).key).toBe(
			"value",
		);
	});

	it("should handle null metadata", () => {
		const logId = uuidv4();
		queries.addProgressLog({
			id: logId,
			task_id: taskId,
			event: "claimed" as ProgressEvent,
			message: "Claimed task",
			metadata: null,
		});

		const logs = queries.getProgressLogs(taskId);
		expect(logs).toHaveLength(1);
		expect(logs[0].metadata).toBeNull();
	});

	it("should retrieve multiple logs in timestamp order", () => {
		// Insert three logs; SQLite default timestamp (datetime('now')) has
		// second-level granularity, so insertion order == timestamp order
		// within the same second. The query uses ORDER BY timestamp ASC.
		const ids = [uuidv4(), uuidv4(), uuidv4()];

		queries.addProgressLog({
			id: ids[0],
			task_id: taskId,
			event: "claimed" as ProgressEvent,
			message: "First",
			metadata: null,
		});
		queries.addProgressLog({
			id: ids[1],
			task_id: taskId,
			event: "started" as ProgressEvent,
			message: "Second",
			metadata: null,
		});
		queries.addProgressLog({
			id: ids[2],
			task_id: taskId,
			event: "progress_update" as ProgressEvent,
			message: "Third",
			metadata: null,
		});

		const logs = queries.getProgressLogs(taskId);
		expect(logs).toHaveLength(3);
		expect(logs[0].message).toBe("First");
		expect(logs[1].message).toBe("Second");
		expect(logs[2].message).toBe("Third");
		// Verify ascending timestamp order
		expect(logs[0].timestamp <= logs[1].timestamp).toBe(true);
		expect(logs[1].timestamp <= logs[2].timestamp).toBe(true);
	});
});
