import Database from "better-sqlite3";
import { TaskQueries } from "../db/queries.js";
import { DagService, dagService } from "./dag-service.js";
import { GitService, createGitService } from "./git-service.js";
import { ConflictService, conflictService } from "./conflict-service.js";
import { v4 as uuidv4 } from "uuid";
import slugify from "slugify";
import { resolve } from "node:path";
import type {
	Task,
	CreateTasksInput,
	CreateTasksOutput,
	ListTasksInput,
	ListTasksOutput,
	GetTaskInput,
	GetTaskOutput,
	ClaimTaskInput,
	ClaimTaskOutput,
	StartTaskInput,
	StartTaskOutput,
	UpdateProgressInput,
	UpdateProgressOutput,
	CompleteTaskInput,
	CompleteTaskOutput,
	MergeTaskInput,
	MergeTaskOutput,
	CleanupTaskInput,
	CleanupTaskOutput,
} from "../types/index.js";

type DB = InstanceType<typeof Database>;

export class TaskService {
	private queries: TaskQueries;
	private dagService: DagService;
	private gitService: GitService;
	private conflictService: ConflictService;

	constructor(db: DB, gitRepoRoot?: string) {
		this.queries = new TaskQueries(db);
		this.dagService = dagService;
		this.conflictService = conflictService;

		// Create git service - use provided root or try to detect it
		if (gitRepoRoot) {
			this.gitService = new GitService(gitRepoRoot);
		} else {
			try {
				this.gitService = createGitService();
			} catch {
				// If not in a git repo, create with cwd as fallback
				this.gitService = new GitService(process.cwd());
			}
		}
	}

	// === Task Management ===

	/**
	 * Create a task group with tasks, dependencies, and file ownership.
	 */
	createTasks(input: CreateTasksInput): CreateTasksOutput {
		const groupId = uuidv4();
		const warnings: string[] = [];

		// 1. Create task group
		this.queries.createGroup({
			id: groupId,
			title: input.group_title,
			description: input.group_description,
			status: "active",
		});

		// 2. Create all tasks with sequence numbers (1-based)
		const sequenceToIdMap = new Map<number, string>();
		const createdTasks: Task[] = [];

		for (let i = 0; i < input.tasks.length; i++) {
			const taskInput = input.tasks[i];
			const sequence = i + 1;
			const taskId = uuidv4();
			sequenceToIdMap.set(sequence, taskId);

			const task = this.queries.createTask({
				id: taskId,
				group_id: groupId,
				sequence,
				title: taskInput.title,
				description: taskInput.description,
				status: "pending", // Will be updated after dependency analysis
				priority: taskInput.priority ?? "medium",
				assigned_to: null,
				branch_name: null,
				worktree_path: null,
				progress: 0,
				progress_note: null,
			});

			createdTasks.push(task);
		}

		// 3. Add dependencies (resolve sequence numbers to task IDs)
		const dependencyMap = new Map<string, string[]>();

		for (let i = 0; i < input.tasks.length; i++) {
			const taskInput = input.tasks[i];
			const sequence = i + 1;
			const taskId = sequenceToIdMap.get(sequence)!;
			const deps: string[] = [];

			if (taskInput.depends_on && taskInput.depends_on.length > 0) {
				for (const depSequence of taskInput.depends_on) {
					const depId = sequenceToIdMap.get(depSequence);
					if (depId) {
						this.queries.addDependency(taskId, depId);
						deps.push(depId);
					} else {
						warnings.push(
							`Task #${sequence} "${taskInput.title}" references invalid dependency sequence #${depSequence}`,
						);
					}
				}
			}

			dependencyMap.set(taskId, deps);
		}

		// 4. Add file ownership
		for (let i = 0; i < input.tasks.length; i++) {
			const taskInput = input.tasks[i];
			const sequence = i + 1;
			const taskId = sequenceToIdMap.get(sequence)!;

			if (taskInput.file_patterns) {
				for (const fp of taskInput.file_patterns) {
					this.queries.addFileOwnership({
						task_id: taskId,
						file_pattern: fp.pattern,
						ownership_type: fp.ownership_type,
					});
				}
			}
		}

		// 5. Validate DAG has no cycles
		const validation = this.dagService.validateNoCycles(dependencyMap);
		if (!validation.valid) {
			warnings.push(
				`Dependency cycle detected: ${validation.cycle?.join(" -> ")}`,
			);
		}

		// 6. Check for file ownership overlaps and generate warnings
		for (let i = 0; i < input.tasks.length; i++) {
			const taskInputI = input.tasks[i];
			const seqI = i + 1;
			const taskIdI = sequenceToIdMap.get(seqI)!;

			if (!taskInputI.file_patterns) continue;

			for (let j = i + 1; j < input.tasks.length; j++) {
				const taskInputJ = input.tasks[j];
				const seqJ = j + 1;

				if (!taskInputJ.file_patterns) continue;

				for (const fpI of taskInputI.file_patterns) {
					for (const fpJ of taskInputJ.file_patterns) {
						if (
							(fpI.ownership_type === "exclusive" ||
								fpJ.ownership_type === "exclusive") &&
							this.conflictService.patternsOverlap(fpI.pattern, fpJ.pattern)
						) {
							warnings.push(
								`File pattern overlap: task #${seqI} "${taskInputI.title}" (${fpI.pattern}) and task #${seqJ} "${taskInputJ.title}" (${fpJ.pattern})`,
							);
						}
					}
				}
			}
		}

		// 7. Set initial status: 'pending' if no deps, 'blocked' if has unmet deps
		const completedTasks = new Set<string>(); // None completed yet
		const outputTasks: CreateTasksOutput["tasks"] = [];

		for (let i = 0; i < createdTasks.length; i++) {
			const sequence = i + 1;
			const taskId = sequenceToIdMap.get(sequence)!;
			const deps = dependencyMap.get(taskId) ?? [];
			const hasDeps = deps.length > 0;

			if (hasDeps) {
				this.queries.updateTask(taskId, { status: "blocked" });
			}

			const canStart = this.dagService.canStart(
				taskId,
				dependencyMap,
				completedTasks,
			);

			outputTasks.push({
				id: taskId,
				sequence,
				title: createdTasks[i].title,
				status: hasDeps ? "blocked" : "pending",
				can_start: canStart,
			});
		}

		return {
			group_id: groupId,
			tasks: outputTasks,
			warnings,
		};
	}

	/**
	 * List tasks with computed can_start and summary.
	 */
	listTasks(input: ListTasksInput): ListTasksOutput {
		const tasks = this.queries.listTasks({
			group_id: input.group_id,
			status: input.status,
		});

		// Build dependency map and completed set for can_start computation
		const dependencyMap = new Map<string, string[]>();
		const completedTasks = new Set<string>();

		for (const task of tasks) {
			const deps = this.queries.getDependencies(task.id);
			dependencyMap.set(
				task.id,
				deps.map((d) => d.id),
			);
			if (task.status === "completed") {
				completedTasks.add(task.id);
			}
		}

		const outputTasks: ListTasksOutput["tasks"] = tasks.map((task) => {
			const deps = this.queries.getDependencies(task.id);
			const canStart =
				task.status === "pending" &&
				this.dagService.canStart(task.id, dependencyMap, completedTasks);

			return {
				id: task.id,
				sequence: task.sequence,
				title: task.title,
				status: task.status,
				progress: task.progress,
				progress_note: task.progress_note,
				assigned_to: task.assigned_to,
				branch_name: task.branch_name,
				worktree_path: task.worktree_path,
				dependencies: deps.map((d) => ({
					sequence: d.sequence,
					title: d.title,
					status: d.status,
				})),
				can_start: canStart,
			};
		});

		// Build summary
		const summary = {
			total: tasks.length,
			pending: tasks.filter((t) => t.status === "pending").length,
			in_progress: tasks.filter((t) => t.status === "in_progress").length,
			in_review: tasks.filter((t) => t.status === "in_review").length,
			completed: tasks.filter((t) => t.status === "completed").length,
			blocked: tasks.filter((t) => t.status === "blocked").length,
		};

		return { tasks: outputTasks, summary };
	}

	/**
	 * Get a task with all related data.
	 */
	getTask(input: GetTaskInput): GetTaskOutput {
		const task = this.queries.getTask(input.task_id);
		if (!task) {
			throw new Error(`Task not found: ${input.task_id}`);
		}

		const deps = this.queries.getDependencies(task.id);
		const fileOwnership = this.queries.getFileOwnership(task.id);
		const progressLogs = this.queries.getProgressLogs(task.id);

		return {
			task,
			dependencies: deps.map((d) => ({
				sequence: d.sequence,
				title: d.title,
				status: d.status,
			})),
			file_ownership: fileOwnership,
			progress_logs: progressLogs,
		};
	}

	// === Agent Workflow ===

	/**
	 * Claim a task for an agent. Uses a transaction for atomicity.
	 */
	claimTask(input: ClaimTaskInput): ClaimTaskOutput {
		const task = this.queries.getTask(input.task_id);
		if (!task) {
			return {
				success: false,
				task: null as unknown as Task,
				error: `Task not found: ${input.task_id}`,
			};
		}

		// 1. Verify task is 'pending'
		if (task.status !== "pending") {
			return {
				success: false,
				task,
				error: `Task is not pending (current status: ${task.status})`,
			};
		}

		// 2. Check all dependencies are 'completed'
		const deps = this.queries.getDependencies(task.id);
		const unmetDeps = deps.filter((d) => d.status !== "completed");
		if (unmetDeps.length > 0) {
			return {
				success: false,
				task,
				error: `Unmet dependencies: ${unmetDeps.map((d) => `#${d.sequence} "${d.title}" (${d.status})`).join(", ")}`,
			};
		}

		// 3. Check file ownership conflicts with in_progress tasks
		const conflicts = this.queries.getFileOwnershipConflicts(task.id);
		if (conflicts.length > 0) {
			return {
				success: false,
				task,
				error: `File ownership conflicts with in-progress tasks: ${conflicts.map((c) => `#${c.task.sequence} "${c.task.title}" on pattern "${c.pattern}"`).join(", ")}`,
			};
		}

		// 4. Update status to 'assigned', set assigned_to (use transaction)
		const agentId = input.agent_id ?? `agent-${uuidv4().slice(0, 8)}`;

		const updatedTask = this.queries.updateTask(task.id, {
			status: "assigned",
			assigned_to: agentId,
		});

		// 5. Log 'claimed' event
		this.queries.addProgressLog({
			id: uuidv4(),
			task_id: task.id,
			event: "claimed",
			message: `Task claimed by ${agentId}`,
			metadata: { agent_id: agentId },
		});

		return {
			success: true,
			task: updatedTask,
		};
	}

	/**
	 * Start a task: create git worktree, update task state.
	 */
	startTask(input: StartTaskInput): StartTaskOutput {
		const task = this.queries.getTask(input.task_id);
		if (!task) {
			throw new Error(`Task not found: ${input.task_id}`);
		}

		// 1. Verify task is 'assigned'
		if (task.status !== "assigned") {
			throw new Error(
				`Task must be 'assigned' to start (current status: ${task.status})`,
			);
		}

		// 2. Generate branch name: task/task-{sequence}-{slugified-title}
		const slugifiedTitle = slugify(task.title, {
			lower: true,
			strict: true,
		}).slice(0, 30);
		const branchName = `task/task-${task.sequence}-${slugifiedTitle}`;

		// 3. Generate worktree path: .worktrees/task-{sequence}-{slugified-title}
		const worktreePath = resolve(
			this.gitService["repoRoot"],
			".worktrees",
			`task-${task.sequence}-${slugifiedTitle}`,
		);

		// 4. Create git worktree
		this.gitService.createWorktree(worktreePath, branchName);

		// 5. Update task with branch_name, worktree_path, started_at, status='in_progress'
		const now = new Date().toISOString();
		const updatedTask = this.queries.updateTask(task.id, {
			status: "in_progress",
			branch_name: branchName,
			worktree_path: worktreePath,
			started_at: now,
		});

		// 6. Log 'started' event
		this.queries.addProgressLog({
			id: uuidv4(),
			task_id: task.id,
			event: "started",
			message: `Task started with branch ${branchName}`,
			metadata: {
				branch_name: branchName,
				worktree_path: worktreePath,
			},
		});

		// 7. Return task context
		const deps = this.queries.getDependencies(task.id);
		const fileOwnership = this.queries.getFileOwnership(task.id);

		return {
			success: true,
			worktree_path: worktreePath,
			branch_name: branchName,
			task: updatedTask,
			context: {
				description: task.description,
				file_patterns: fileOwnership.map((fo) => fo.file_pattern),
				dependencies_completed: deps
					.filter((d) => d.status === "completed")
					.map((d) => ({
						title: d.title,
						branch_name: d.branch_name ?? "",
					})),
			},
		};
	}

	/**
	 * Update progress on a task.
	 */
	updateProgress(input: UpdateProgressInput): UpdateProgressOutput {
		const task = this.queries.getTask(input.task_id);
		if (!task) {
			throw new Error(`Task not found: ${input.task_id}`);
		}

		// 1. Update progress and progress_note
		this.queries.updateTask(task.id, {
			progress: input.progress,
			progress_note: input.note,
		});

		// 2. Check files_changed against other tasks' file ownership
		let conflictWarnings: string[] = [];
		if (input.files_changed && input.files_changed.length > 0) {
			// Get all in-progress tasks except this one
			const allTasks = this.queries.listTasks({
				group_id: task.group_id,
				status: ["in_progress"],
			});
			const otherTasks = allTasks
				.filter((t) => t.id !== task.id)
				.map((t) => ({
					task: t,
					patterns: this.queries.getFileOwnership(t.id),
				}));

			conflictWarnings = this.conflictService.checkFileConflicts(
				input.files_changed,
				otherTasks,
			);
		}

		// 3. Check if main has new commits (rebase recommendation)
		let rebaseRecommended = false;
		if (task.branch_name) {
			try {
				const mainCommit = this.gitService.getLatestCommit("HEAD");
				rebaseRecommended = this.gitService.hasNewCommitsSince(mainCommit);
			} catch {
				// Ignore git errors for rebase check
			}
		}

		// 4. Log 'progress_update' event
		this.queries.addProgressLog({
			id: uuidv4(),
			task_id: task.id,
			event: "progress_update",
			message: input.note,
			metadata: {
				progress: input.progress,
				files_changed: input.files_changed ?? [],
				conflict_warnings: conflictWarnings,
			},
		});

		return {
			success: true,
			conflict_warnings: conflictWarnings,
			rebase_recommended: rebaseRecommended,
		};
	}

	/**
	 * Mark a task as complete and find unlocked downstream tasks.
	 */
	completeTask(input: CompleteTaskInput): CompleteTaskOutput {
		const task = this.queries.getTask(input.task_id);
		if (!task) {
			throw new Error(`Task not found: ${input.task_id}`);
		}

		// 1. Verify task is 'in_progress'
		if (task.status !== "in_progress") {
			throw new Error(
				`Task must be 'in_progress' to complete (current status: ${task.status})`,
			);
		}

		// 2. Update status to 'in_review', set completed_at
		const now = new Date().toISOString();
		const updatedTask = this.queries.updateTask(task.id, {
			status: "in_review",
			completed_at: now,
			progress: 100,
			progress_note: input.summary,
		});

		// 3. Find unlocked downstream tasks
		const allGroupTasks = this.queries.listTasks({ group_id: task.group_id });
		const completedTasks = new Set(
			allGroupTasks
				.filter((t) => t.status === "completed" || t.status === "in_review")
				.map((t) => t.id),
		);
		// Include the current task as effectively completed
		completedTasks.add(task.id);

		const dependencyMap = new Map<string, string[]>();
		for (const t of allGroupTasks) {
			const deps = this.queries.getDependencies(t.id);
			dependencyMap.set(
				t.id,
				deps.map((d) => d.id),
			);
		}

		const unlockedIds = this.dagService.getUnlockedTasks(
			task.id,
			dependencyMap,
			completedTasks,
		);

		const unlockedTasks = unlockedIds
			.map((id) => allGroupTasks.find((t) => t.id === id))
			.filter((t): t is Task => t !== undefined)
			.map((t) => ({
				sequence: t.sequence,
				title: t.title,
			}));

		// Update unlocked tasks from 'blocked' to 'pending'
		for (const id of unlockedIds) {
			const t = allGroupTasks.find((at) => at.id === id);
			if (t && t.status === "blocked") {
				this.queries.updateTask(id, { status: "pending" });
			}
		}

		// 4. Log 'completed' event
		this.queries.addProgressLog({
			id: uuidv4(),
			task_id: task.id,
			event: "completed",
			message: input.summary,
			metadata: {
				files_changed: input.files_changed,
				unlocked_tasks: unlockedTasks,
			},
		});

		return {
			success: true,
			task: updatedTask,
			unlocked_tasks: unlockedTasks,
		};
	}

	// === Integration ===

	/**
	 * Merge a task's branch into the main branch.
	 */
	mergeTask(input: MergeTaskInput): MergeTaskOutput {
		// 1. Verify on main branch
		if (!this.gitService.isOnMainBranch()) {
			throw new Error(
				"Must be on main/master branch to merge. Current branch: " +
					this.gitService.getCurrentBranch(),
			);
		}

		const task = this.queries.getTask(input.task_id);
		if (!task) {
			throw new Error(`Task not found: ${input.task_id}`);
		}

		// 2. Verify task is 'in_review'
		if (task.status !== "in_review") {
			throw new Error(
				`Task must be 'in_review' to merge (current status: ${task.status})`,
			);
		}

		if (!task.branch_name) {
			throw new Error("Task has no branch to merge");
		}

		const strategy = input.strategy ?? "squash";

		// 3. Attempt merge
		const mergeResult = this.gitService.mergeBranch(task.branch_name, strategy);

		if (mergeResult.success) {
			// 4. If success: update status to 'completed', set merged_at
			const now = new Date().toISOString();
			this.queries.updateTask(task.id, {
				status: "completed",
				merged_at: now,
			});

			// Cleanup worktree and branch
			if (task.worktree_path) {
				try {
					if (this.gitService.worktreeExists(task.worktree_path)) {
						this.gitService.removeWorktree(task.worktree_path);
					}
				} catch {
					// Best-effort cleanup
				}
			}

			try {
				this.gitService.deleteBranch(task.branch_name);
			} catch {
				// Best-effort cleanup
			}

			// Find unlocked tasks
			const allGroupTasks = this.queries.listTasks({
				group_id: task.group_id,
			});
			const completedTasks = new Set(
				allGroupTasks.filter((t) => t.status === "completed").map((t) => t.id),
			);

			const dependencyMap = new Map<string, string[]>();
			for (const t of allGroupTasks) {
				const deps = this.queries.getDependencies(t.id);
				dependencyMap.set(
					t.id,
					deps.map((d) => d.id),
				);
			}

			const unlockedIds = this.dagService.getUnlockedTasks(
				task.id,
				dependencyMap,
				completedTasks,
			);

			const unlockedTasks = unlockedIds
				.map((id) => allGroupTasks.find((t) => t.id === id))
				.filter((t): t is Task => t !== undefined)
				.map((t) => {
					const canStart = this.dagService.canStart(
						t.id,
						dependencyMap,
						completedTasks,
					);
					return {
						sequence: t.sequence,
						title: t.title,
						can_start: canStart,
					};
				});

			// Update unlocked tasks from 'blocked' to 'pending'
			for (const id of unlockedIds) {
				const t = allGroupTasks.find((at) => at.id === id);
				if (t && t.status === "blocked") {
					this.queries.updateTask(id, { status: "pending" });
				}
			}

			// 6. Log 'merged' event
			this.queries.addProgressLog({
				id: uuidv4(),
				task_id: task.id,
				event: "merged",
				message: `Task merged via ${strategy} strategy`,
				metadata: {
					strategy,
					unlocked_tasks: unlockedTasks,
				},
			});

			return {
				success: true,
				merge_result: "clean",
				unlocked_tasks: unlockedTasks,
			};
		} else {
			// 5. If conflict: return conflict details
			const conflicts = mergeResult.conflicts.map((file) => ({
				file,
				description: `Merge conflict in ${file}`,
				auto_resolvable: false,
				suggestion: `Manually resolve conflicts in ${file} and commit the result`,
			}));

			// Log conflict event
			this.queries.addProgressLog({
				id: uuidv4(),
				task_id: task.id,
				event: "conflict_detected",
				message: `Merge conflicts detected in ${mergeResult.conflicts.length} file(s)`,
				metadata: {
					conflicted_files: mergeResult.conflicts,
					strategy,
				},
			});

			return {
				success: false,
				merge_result: "conflict",
				conflicts,
				unlocked_tasks: [],
			};
		}
	}

	/**
	 * Clean up a task: remove worktree, delete branch, mark as failed.
	 */
	cleanupTask(input: CleanupTaskInput): CleanupTaskOutput {
		const task = this.queries.getTask(input.task_id);
		if (!task) {
			throw new Error(`Task not found: ${input.task_id}`);
		}

		let worktreeRemoved = false;
		let branchRemoved = false;

		// 1. Remove worktree if exists
		if (task.worktree_path) {
			try {
				if (this.gitService.worktreeExists(task.worktree_path)) {
					this.gitService.removeWorktree(task.worktree_path);
					worktreeRemoved = true;
				}
			} catch {
				// Best-effort cleanup
			}
		}

		// 2. Delete branch if exists
		if (task.branch_name) {
			try {
				this.gitService.deleteBranch(task.branch_name);
				branchRemoved = true;
			} catch {
				// Best-effort cleanup - branch might not exist
			}
		}

		// 3. Update status to 'failed'
		this.queries.updateTask(task.id, {
			status: "failed",
		});

		// 4. Log 'failed' event
		this.queries.addProgressLog({
			id: uuidv4(),
			task_id: task.id,
			event: "failed",
			message: input.reason ?? "Task cleaned up and marked as failed",
			metadata: {
				reason: input.reason,
				worktree_removed: worktreeRemoved,
				branch_removed: branchRemoved,
			},
		});

		return {
			success: true,
			cleaned: {
				worktree_removed: worktreeRemoved,
				branch_removed: branchRemoved,
			},
		};
	}
}
