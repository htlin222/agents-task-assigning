import { describe, it, expect, beforeEach, vi } from "vitest";
import { getDbForTesting } from "../../src/db/connection.js";
import { TaskService } from "../../src/services/task-service.js";
import type Database from "better-sqlite3";

type DB = InstanceType<typeof Database>;

// Mock git-service to avoid real git operations
vi.mock("../../src/services/git-service.js", () => {
	class MockGitService {
		repoRoot = "/tmp/test-repo";
		static getRepoRoot() {
			return "/tmp/test-repo";
		}
		createWorktree() {}
		removeWorktree() {}
		deleteBranch() {}
		getCurrentBranch() {
			return "main";
		}
		isOnMainBranch() {
			return true;
		}
		getLatestCommit() {
			return "abc123";
		}
		worktreeExists() {
			return false;
		}
		mergeBranch() {
			return { success: true, conflicts: [] };
		}
		abortMerge() {}
		getConflictedFiles() {
			return [];
		}
		hasNewCommitsSince() {
			return false;
		}
	}
	return {
		GitService: MockGitService,
		createGitService: () => new MockGitService(),
	};
});

let db: DB;
let service: TaskService;

beforeEach(() => {
	db = getDbForTesting();
	service = new TaskService(db, "/tmp/test-repo");
});

describe("TaskService", () => {
	describe("createTasks", () => {
		it("creates a task group with independent tasks", () => {
			const result = service.createTasks({
				group_title: "Blog System",
				group_description: "Build a blog",
				tasks: [
					{ title: "DB Schema", description: "Create DB schema" },
					{ title: "Auth System", description: "Build auth" },
				],
			});

			expect(result.group_id).toBeDefined();
			expect(result.tasks).toHaveLength(2);
			expect(result.tasks[0].sequence).toBe(1);
			expect(result.tasks[0].title).toBe("DB Schema");
			expect(result.tasks[0].status).toBe("pending");
			expect(result.tasks[0].can_start).toBe(true);
			expect(result.tasks[1].sequence).toBe(2);
			expect(result.tasks[1].can_start).toBe(true);
			expect(result.warnings).toHaveLength(0);
		});

		it("creates tasks with dependencies and marks blocked tasks", () => {
			const result = service.createTasks({
				group_title: "Blog System",
				group_description: "Build a blog",
				tasks: [
					{ title: "DB Schema", description: "Create schema" },
					{ title: "CRUD API", description: "Build API", depends_on: [1] },
					{ title: "Frontend", description: "Build UI", depends_on: [2] },
				],
			});

			expect(result.tasks[0].status).toBe("pending");
			expect(result.tasks[0].can_start).toBe(true);
			expect(result.tasks[1].status).toBe("blocked");
			expect(result.tasks[1].can_start).toBe(false);
			expect(result.tasks[2].status).toBe("blocked");
			expect(result.tasks[2].can_start).toBe(false);
		});

		it("warns about file ownership overlaps", () => {
			const result = service.createTasks({
				group_title: "Test",
				group_description: "Test",
				tasks: [
					{
						title: "Task A",
						description: "A",
						file_patterns: [
							{ pattern: "src/db/**", ownership_type: "exclusive" },
						],
					},
					{
						title: "Task B",
						description: "B",
						file_patterns: [
							{ pattern: "src/db/**", ownership_type: "exclusive" },
						],
					},
				],
			});

			expect(result.warnings.length).toBeGreaterThan(0);
			expect(result.warnings[0]).toContain("File pattern overlap");
		});

		it("warns about invalid dependency references", () => {
			const result = service.createTasks({
				group_title: "Test",
				group_description: "Test",
				tasks: [{ title: "Task A", description: "A", depends_on: [99] }],
			});

			expect(result.warnings.length).toBeGreaterThan(0);
			expect(result.warnings[0]).toContain("invalid dependency");
		});
	});

	describe("listTasks", () => {
		it("lists all tasks with summary", () => {
			const created = service.createTasks({
				group_title: "Test",
				group_description: "Test",
				tasks: [
					{ title: "Task 1", description: "D1" },
					{ title: "Task 2", description: "D2", depends_on: [1] },
				],
			});

			const result = service.listTasks({ group_id: created.group_id });

			expect(result.tasks).toHaveLength(2);
			expect(result.summary.total).toBe(2);
			expect(result.summary.pending).toBe(1);
			expect(result.summary.blocked).toBe(1);
		});

		it("filters by status", () => {
			const created = service.createTasks({
				group_title: "Test",
				group_description: "Test",
				tasks: [
					{ title: "Task 1", description: "D1" },
					{ title: "Task 2", description: "D2", depends_on: [1] },
				],
			});

			const result = service.listTasks({
				group_id: created.group_id,
				status: ["pending"],
			});

			expect(result.tasks).toHaveLength(1);
			expect(result.tasks[0].title).toBe("Task 1");
		});
	});

	describe("getTask", () => {
		it("returns full task details", () => {
			const created = service.createTasks({
				group_title: "Test",
				group_description: "Test",
				tasks: [
					{
						title: "Task 1",
						description: "Description",
						file_patterns: [{ pattern: "src/**", ownership_type: "exclusive" }],
					},
				],
			});

			const result = service.getTask({ task_id: created.tasks[0].id });

			expect(result.task.title).toBe("Task 1");
			expect(result.file_ownership).toHaveLength(1);
			expect(result.dependencies).toHaveLength(0);
		});

		it("throws for non-existent task", () => {
			expect(() => service.getTask({ task_id: "nonexistent" })).toThrow(
				"Task not found",
			);
		});
	});

	describe("claimTask", () => {
		it("claims a pending task successfully", () => {
			const created = service.createTasks({
				group_title: "Test",
				group_description: "Test",
				tasks: [{ title: "Task 1", description: "D1" }],
			});

			const result = service.claimTask({
				task_id: created.tasks[0].id,
				agent_id: "agent-test",
			});

			expect(result.success).toBe(true);
			expect(result.task.status).toBe("assigned");
			expect(result.task.assigned_to).toBe("agent-test");
		});

		it("fails to claim a non-pending task", () => {
			const created = service.createTasks({
				group_title: "Test",
				group_description: "Test",
				tasks: [{ title: "Task 1", description: "D1" }],
			});

			// Claim once
			service.claimTask({ task_id: created.tasks[0].id, agent_id: "agent-1" });

			// Try to claim again
			const result = service.claimTask({
				task_id: created.tasks[0].id,
				agent_id: "agent-2",
			});

			expect(result.success).toBe(false);
			expect(result.error).toContain("not pending");
		});

		it("fails to claim a task with unmet dependencies", () => {
			const created = service.createTasks({
				group_title: "Test",
				group_description: "Test",
				tasks: [
					{ title: "Task 1", description: "D1" },
					{ title: "Task 2", description: "D2", depends_on: [1] },
				],
			});

			// Task 2 is blocked, manually set it to pending to test claim validation
			db.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(
				"pending",
				created.tasks[1].id,
			);

			const result = service.claimTask({ task_id: created.tasks[1].id });

			expect(result.success).toBe(false);
			expect(result.error).toContain("Unmet dependencies");
		});

		it("generates agent_id when not provided", () => {
			const created = service.createTasks({
				group_title: "Test",
				group_description: "Test",
				tasks: [{ title: "Task 1", description: "D1" }],
			});

			const result = service.claimTask({ task_id: created.tasks[0].id });

			expect(result.success).toBe(true);
			expect(result.task.assigned_to).toMatch(/^agent-/);
		});
	});

	describe("startTask", () => {
		it("starts an assigned task", () => {
			const created = service.createTasks({
				group_title: "Test",
				group_description: "Test",
				tasks: [{ title: "DB Schema", description: "Create schema" }],
			});

			service.claimTask({ task_id: created.tasks[0].id, agent_id: "agent-1" });

			const result = service.startTask({ task_id: created.tasks[0].id });

			expect(result.success).toBe(true);
			expect(result.branch_name).toMatch(/^task\/task-1-/);
			expect(result.worktree_path).toContain("task-1-");
			expect(result.task.status).toBe("in_progress");
			expect(result.context.description).toBe("Create schema");
		});

		it("throws if task is not assigned", () => {
			const created = service.createTasks({
				group_title: "Test",
				group_description: "Test",
				tasks: [{ title: "Task 1", description: "D1" }],
			});

			expect(() => service.startTask({ task_id: created.tasks[0].id })).toThrow(
				"Task must be 'assigned'",
			);
		});
	});

	describe("updateProgress", () => {
		it("updates progress on an in-progress task", () => {
			const created = service.createTasks({
				group_title: "Test",
				group_description: "Test",
				tasks: [{ title: "Task 1", description: "D1" }],
			});

			service.claimTask({ task_id: created.tasks[0].id });
			service.startTask({ task_id: created.tasks[0].id });

			const result = service.updateProgress({
				task_id: created.tasks[0].id,
				progress: 50,
				note: "Halfway done",
			});

			expect(result.success).toBe(true);
			expect(result.rebase_recommended).toBe(false);

			// Verify progress was saved
			const task = service.getTask({ task_id: created.tasks[0].id });
			expect(task.task.progress).toBe(50);
			expect(task.task.progress_note).toBe("Halfway done");
		});
	});

	describe("completeTask", () => {
		it("completes a task and unlocks dependents", () => {
			const created = service.createTasks({
				group_title: "Test",
				group_description: "Test",
				tasks: [
					{ title: "Task 1", description: "D1" },
					{ title: "Task 2", description: "D2", depends_on: [1] },
				],
			});

			// Claim and start task 1
			service.claimTask({ task_id: created.tasks[0].id });
			service.startTask({ task_id: created.tasks[0].id });

			const result = service.completeTask({
				task_id: created.tasks[0].id,
				summary: "Done",
				files_changed: ["src/schema.ts"],
			});

			expect(result.success).toBe(true);
			expect(result.task.status).toBe("in_review");
			expect(result.unlocked_tasks).toHaveLength(1);
			expect(result.unlocked_tasks[0].title).toBe("Task 2");

			// Verify Task 2 was unblocked
			const task2 = service.getTask({ task_id: created.tasks[1].id });
			expect(task2.task.status).toBe("pending");
		});

		it("throws if task is not in_progress", () => {
			const created = service.createTasks({
				group_title: "Test",
				group_description: "Test",
				tasks: [{ title: "Task 1", description: "D1" }],
			});

			expect(() =>
				service.completeTask({
					task_id: created.tasks[0].id,
					summary: "Done",
					files_changed: [],
				}),
			).toThrow("Task must be 'in_progress'");
		});
	});

	describe("mergeTask", () => {
		it("merges a task in review", () => {
			const created = service.createTasks({
				group_title: "Test",
				group_description: "Test",
				tasks: [{ title: "Task 1", description: "D1" }],
			});

			// Go through full lifecycle
			service.claimTask({ task_id: created.tasks[0].id });
			service.startTask({ task_id: created.tasks[0].id });
			service.completeTask({
				task_id: created.tasks[0].id,
				summary: "Done",
				files_changed: [],
			});

			const result = service.mergeTask({ task_id: created.tasks[0].id });

			expect(result.success).toBe(true);
			expect(result.merge_result).toBe("clean");

			// Verify task is completed
			const task = service.getTask({ task_id: created.tasks[0].id });
			expect(task.task.status).toBe("completed");
			expect(task.task.merged_at).toBeDefined();
		});

		it("throws if task is not in_review", () => {
			const created = service.createTasks({
				group_title: "Test",
				group_description: "Test",
				tasks: [{ title: "Task 1", description: "D1" }],
			});

			expect(() => service.mergeTask({ task_id: created.tasks[0].id })).toThrow(
				"Task must be 'in_review'",
			);
		});
	});

	describe("cleanupTask", () => {
		it("cleans up a task and marks it as failed", () => {
			const created = service.createTasks({
				group_title: "Test",
				group_description: "Test",
				tasks: [{ title: "Task 1", description: "D1" }],
			});

			service.claimTask({ task_id: created.tasks[0].id });
			service.startTask({ task_id: created.tasks[0].id });

			const result = service.cleanupTask({
				task_id: created.tasks[0].id,
				reason: "Abandoned",
			});

			expect(result.success).toBe(true);

			const task = service.getTask({ task_id: created.tasks[0].id });
			expect(task.task.status).toBe("failed");
		});
	});

	describe("full lifecycle", () => {
		it("handles complete workflow: create → claim → start → update → complete → merge", () => {
			const created = service.createTasks({
				group_title: "Blog System",
				group_description: "Build a blog",
				tasks: [
					{
						title: "DB Schema",
						description: "Create DB schema",
						priority: "high",
					},
					{ title: "Auth", description: "Build auth" },
					{ title: "CRUD API", description: "Build API", depends_on: [1, 2] },
				],
			});

			expect(created.tasks).toHaveLength(3);
			expect(created.tasks[2].status).toBe("blocked");

			// Claim and complete Task 1
			service.claimTask({ task_id: created.tasks[0].id, agent_id: "agent-1" });
			service.startTask({ task_id: created.tasks[0].id });
			service.updateProgress({
				task_id: created.tasks[0].id,
				progress: 50,
				note: "Halfway",
			});
			const complete1 = service.completeTask({
				task_id: created.tasks[0].id,
				summary: "Schema done",
				files_changed: ["src/db/schema.ts"],
			});

			// Task 3 should NOT be unlocked yet (still depends on Task 2)
			expect(complete1.unlocked_tasks).toHaveLength(0);

			// Merge Task 1
			service.mergeTask({ task_id: created.tasks[0].id });

			// Claim and complete Task 2
			service.claimTask({ task_id: created.tasks[1].id, agent_id: "agent-2" });
			service.startTask({ task_id: created.tasks[1].id });
			const complete2 = service.completeTask({
				task_id: created.tasks[1].id,
				summary: "Auth done",
				files_changed: ["src/auth/login.ts"],
			});

			// Task 3 should now be unlocked
			expect(complete2.unlocked_tasks).toHaveLength(1);
			expect(complete2.unlocked_tasks[0].title).toBe("CRUD API");

			// Verify Task 3 is now pending
			const task3 = service.getTask({ task_id: created.tasks[2].id });
			expect(task3.task.status).toBe("pending");

			// Verify progress logs
			const task1Detail = service.getTask({ task_id: created.tasks[0].id });
			expect(task1Detail.progress_logs.length).toBeGreaterThanOrEqual(4); // claimed, started, progress_update, completed, merged
		});
	});
});
