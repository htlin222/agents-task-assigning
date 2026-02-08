import { describe, it, expect } from "vitest";
import { conflictService } from "../../src/services/conflict-service.js";
import type { Task, TaskFileOwnership } from "../../src/types/index.js";

const mockTask = (overrides: Partial<Task> = {}): Task => ({
	id: "task-1",
	group_id: "group-1",
	sequence: 1,
	title: "Test Task",
	description: "Test",
	status: "in_progress" as const,
	priority: "medium" as const,
	assigned_to: null,
	branch_name: null,
	worktree_path: null,
	progress: 0,
	progress_note: null,
	created_at: "2024-01-01",
	started_at: null,
	completed_at: null,
	merged_at: null,
	...overrides,
});

const mockOwnership = (
	overrides: Partial<TaskFileOwnership> = {},
): TaskFileOwnership => ({
	task_id: "task-1",
	file_pattern: "src/**",
	ownership_type: "exclusive",
	...overrides,
});

describe("ConflictService", () => {
	describe("patternsOverlap", () => {
		it("identifies identical patterns as overlapping", () => {
			expect(conflictService.patternsOverlap("src/db/**", "src/db/**")).toBe(
				true,
			);
		});

		it("identifies prefix relationship as overlapping (src/db/** and src/db/queries/**)", () => {
			expect(
				conflictService.patternsOverlap("src/db/**", "src/db/queries/**"),
			).toBe(true);
		});

		it("identifies non-overlapping patterns (src/db/** and src/auth/**)", () => {
			expect(conflictService.patternsOverlap("src/db/**", "src/auth/**")).toBe(
				false,
			);
		});

		it("identifies parent pattern overlapping with child (src/** and src/db/**)", () => {
			expect(conflictService.patternsOverlap("src/**", "src/db/**")).toBe(true);
		});

		it("treats empty pattern as overlapping with everything (catch-all)", () => {
			expect(conflictService.patternsOverlap("**", "src/db/**")).toBe(true);
			expect(conflictService.patternsOverlap("src/db/**", "**")).toBe(true);
		});
	});

	describe("fileMatchesPatterns", () => {
		it("matches a file inside a glob directory pattern", () => {
			expect(
				conflictService.fileMatchesPatterns("src/db/schema.ts", ["src/db/**"]),
			).toBe(true);
		});

		it("does not match a file outside the pattern directory", () => {
			expect(
				conflictService.fileMatchesPatterns("src/auth/login.ts", ["src/db/**"]),
			).toBe(false);
		});

		it("matches a file with an exact pattern", () => {
			expect(
				conflictService.fileMatchesPatterns("src/index.ts", ["src/index.ts"]),
			).toBe(true);
		});

		it("returns false when patterns array is empty", () => {
			expect(conflictService.fileMatchesPatterns("src/db/schema.ts", [])).toBe(
				false,
			);
		});
	});

	describe("findConflicts", () => {
		it("returns no conflicts when patterns do not overlap", () => {
			const taskPatterns: TaskFileOwnership[] = [
				mockOwnership({
					task_id: "task-1",
					file_pattern: "src/db/**",
					ownership_type: "exclusive",
				}),
			];
			const otherTasks = [
				{
					task: mockTask({ id: "task-2", sequence: 2, title: "Other Task" }),
					patterns: [
						mockOwnership({
							task_id: "task-2",
							file_pattern: "src/auth/**",
							ownership_type: "exclusive",
						}),
					],
				},
			];
			const conflicts = conflictService.findConflicts(taskPatterns, otherTasks);
			expect(conflicts).toHaveLength(0);
		});

		it("detects a conflict when exclusive patterns overlap", () => {
			const taskPatterns: TaskFileOwnership[] = [
				mockOwnership({
					task_id: "task-1",
					file_pattern: "src/db/**",
					ownership_type: "exclusive",
				}),
			];
			const otherTasks = [
				{
					task: mockTask({ id: "task-2", sequence: 2, title: "Other Task" }),
					patterns: [
						mockOwnership({
							task_id: "task-2",
							file_pattern: "src/db/queries/**",
							ownership_type: "exclusive",
						}),
					],
				},
			];
			const conflicts = conflictService.findConflicts(taskPatterns, otherTasks);
			expect(conflicts).toHaveLength(1);
			expect(conflicts[0].task.id).toBe("task-2");
			expect(conflicts[0].conflicting_pattern).toBe("src/db/queries/**");
			expect(conflicts[0].ownership_type).toBe("exclusive");
		});

		it("returns no conflict when both sides are shared", () => {
			const taskPatterns: TaskFileOwnership[] = [
				mockOwnership({
					task_id: "task-1",
					file_pattern: "src/shared/**",
					ownership_type: "shared",
				}),
			];
			const otherTasks = [
				{
					task: mockTask({ id: "task-2", sequence: 2, title: "Other Task" }),
					patterns: [
						mockOwnership({
							task_id: "task-2",
							file_pattern: "src/shared/utils/**",
							ownership_type: "shared",
						}),
					],
				},
			];
			const conflicts = conflictService.findConflicts(taskPatterns, otherTasks);
			expect(conflicts).toHaveLength(0);
		});

		it("reports multiple conflicts across multiple tasks", () => {
			const taskPatterns: TaskFileOwnership[] = [
				mockOwnership({
					task_id: "task-1",
					file_pattern: "src/**",
					ownership_type: "exclusive",
				}),
			];
			const otherTasks = [
				{
					task: mockTask({ id: "task-2", sequence: 2, title: "Task 2" }),
					patterns: [
						mockOwnership({
							task_id: "task-2",
							file_pattern: "src/db/**",
							ownership_type: "shared",
						}),
					],
				},
				{
					task: mockTask({ id: "task-3", sequence: 3, title: "Task 3" }),
					patterns: [
						mockOwnership({
							task_id: "task-3",
							file_pattern: "src/auth/**",
							ownership_type: "shared",
						}),
					],
				},
			];
			const conflicts = conflictService.findConflicts(taskPatterns, otherTasks);
			expect(conflicts).toHaveLength(2);
			expect(conflicts.map((c) => c.task.id)).toContain("task-2");
			expect(conflicts.map((c) => c.task.id)).toContain("task-3");
		});
	});

	describe("checkFileConflicts", () => {
		it("returns no warnings when changed files do not match other tasks patterns", () => {
			const changedFiles = ["src/ui/button.ts"];
			const otherTasks = [
				{
					task: mockTask({ id: "task-2", sequence: 2, title: "DB Task" }),
					patterns: [
						mockOwnership({
							task_id: "task-2",
							file_pattern: "src/db/**",
							ownership_type: "exclusive",
						}),
					],
				},
			];
			const warnings = conflictService.checkFileConflicts(
				changedFiles,
				otherTasks,
			);
			expect(warnings).toHaveLength(0);
		});

		it("generates a warning when a changed file matches another task exclusive pattern", () => {
			const changedFiles = ["src/db/schema.ts"];
			const otherTasks = [
				{
					task: mockTask({ id: "task-2", sequence: 2, title: "DB Task" }),
					patterns: [
						mockOwnership({
							task_id: "task-2",
							file_pattern: "src/db/**",
							ownership_type: "exclusive",
						}),
					],
				},
			];
			const warnings = conflictService.checkFileConflicts(
				changedFiles,
				otherTasks,
			);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("src/db/schema.ts");
			expect(warnings[0]).toContain("DB Task");
			expect(warnings[0]).toContain("exclusive");
		});

		it("generates multiple warnings for multiple conflicting files", () => {
			const changedFiles = ["src/db/schema.ts", "src/auth/login.ts"];
			const otherTasks = [
				{
					task: mockTask({ id: "task-2", sequence: 2, title: "DB Task" }),
					patterns: [
						mockOwnership({
							task_id: "task-2",
							file_pattern: "src/db/**",
							ownership_type: "exclusive",
						}),
					],
				},
				{
					task: mockTask({ id: "task-3", sequence: 3, title: "Auth Task" }),
					patterns: [
						mockOwnership({
							task_id: "task-3",
							file_pattern: "src/auth/**",
							ownership_type: "exclusive",
						}),
					],
				},
			];
			const warnings = conflictService.checkFileConflicts(
				changedFiles,
				otherTasks,
			);
			expect(warnings).toHaveLength(2);
			expect(warnings.some((w) => w.includes("src/db/schema.ts"))).toBe(true);
			expect(warnings.some((w) => w.includes("src/auth/login.ts"))).toBe(true);
		});
	});
});
