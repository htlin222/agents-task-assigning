import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "./db/connection.js";
import { TaskService } from "./services/task-service.js";

let taskService: TaskService | null = null;

function getTaskService(): TaskService {
	if (!taskService) {
		const db = getDb();
		taskService = new TaskService(db);
	}
	return taskService;
}

export function createServer(): McpServer {
	const server = new McpServer({
		name: "task-manager",
		version: "0.1.0",
	});

	// ── create_tasks ────────────────────────────────────────────────────
	server.tool(
		"create_tasks",
		"Create a group of tasks from a high-level requirement. Analyzes dependencies and file ownership.",
		{
			group_title: z.string().describe("Title for the task group"),
			group_description: z
				.string()
				.describe("Description of the overall requirement"),
			tasks: z.array(
				z.object({
					title: z.string(),
					description: z.string(),
					priority: z
						.enum(["high", "medium", "low"])
						.optional()
						.default("medium"),
					depends_on: z.array(z.number()).optional().default([]),
					file_patterns: z
						.array(
							z.object({
								pattern: z.string(),
								ownership_type: z.enum(["exclusive", "shared"]),
							}),
						)
						.optional()
						.default([]),
				}),
			),
		},
		async (params) => {
			try {
				const result = getTaskService().createTasks(params);
				return {
					content: [
						{ type: "text" as const, text: JSON.stringify(result, null, 2) },
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	// ── list_tasks ──────────────────────────────────────────────────────
	server.tool(
		"list_tasks",
		"List tasks with optional filtering by group and status. Can include progress details.",
		{
			group_id: z.string().optional(),
			status: z
				.array(
					z.enum([
						"pending",
						"assigned",
						"in_progress",
						"in_review",
						"completed",
						"failed",
						"blocked",
					]),
				)
				.optional(),
			include_progress: z.boolean().optional().default(false),
		},
		async (params) => {
			try {
				const result = getTaskService().listTasks(params);
				return {
					content: [
						{ type: "text" as const, text: JSON.stringify(result, null, 2) },
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	// ── get_task ────────────────────────────────────────────────────────
	server.tool(
		"get_task",
		"Get detailed information about a specific task including dependencies, file ownership, and progress logs.",
		{
			task_id: z.string(),
		},
		async (params) => {
			try {
				const result = getTaskService().getTask(params);
				return {
					content: [
						{ type: "text" as const, text: JSON.stringify(result, null, 2) },
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	// ── claim_task ──────────────────────────────────────────────────────
	server.tool(
		"claim_task",
		"Claim a task for an agent. Assigns the task and checks for dependency and file ownership conflicts.",
		{
			task_id: z.string(),
			agent_id: z.string().optional(),
		},
		async (params) => {
			try {
				const result = getTaskService().claimTask(params);
				return {
					content: [
						{ type: "text" as const, text: JSON.stringify(result, null, 2) },
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	// ── start_task ──────────────────────────────────────────────────────
	server.tool(
		"start_task",
		"Start working on a claimed task. Creates a git worktree and branch for isolated work.",
		{
			task_id: z.string(),
		},
		async (params) => {
			try {
				const result = getTaskService().startTask(params);
				return {
					content: [
						{ type: "text" as const, text: JSON.stringify(result, null, 2) },
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	// ── update_progress ─────────────────────────────────────────────────
	server.tool(
		"update_progress",
		"Update progress on an in-progress task. Reports percentage complete and checks for file conflicts.",
		{
			task_id: z.string(),
			progress: z.number().min(0).max(100),
			note: z.string(),
			files_changed: z.array(z.string()).optional(),
		},
		async (params) => {
			try {
				const result = getTaskService().updateProgress(params);
				return {
					content: [
						{ type: "text" as const, text: JSON.stringify(result, null, 2) },
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	// ── complete_task ───────────────────────────────────────────────────
	server.tool(
		"complete_task",
		"Mark a task as completed with a summary and list of changed files. Moves task to in_review status.",
		{
			task_id: z.string(),
			summary: z.string(),
			files_changed: z.array(z.string()),
		},
		async (params) => {
			try {
				const result = getTaskService().completeTask(params);
				return {
					content: [
						{ type: "text" as const, text: JSON.stringify(result, null, 2) },
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	// ── merge_task ──────────────────────────────────────────────────────
	server.tool(
		"merge_task",
		"Merge a completed task branch back into the main branch. Supports merge and squash strategies.",
		{
			task_id: z.string(),
			strategy: z.enum(["merge", "squash"]).optional().default("squash"),
		},
		async (params) => {
			try {
				const result = getTaskService().mergeTask(params);
				return {
					content: [
						{ type: "text" as const, text: JSON.stringify(result, null, 2) },
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	// ── cleanup_task ────────────────────────────────────────────────────
	server.tool(
		"cleanup_task",
		"Clean up a task by removing its worktree and branch. Used after merging or to abandon a task.",
		{
			task_id: z.string(),
			reason: z.string().optional(),
		},
		async (params) => {
			try {
				const result = getTaskService().cleanupTask(params);
				return {
					content: [
						{ type: "text" as const, text: JSON.stringify(result, null, 2) },
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	return server;
}

export const server = createServer();
