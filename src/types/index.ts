export type TaskGroupStatus = "active" | "completed" | "archived";

export interface TaskGroup {
	id: string;
	title: string;
	description: string;
	created_at: string;
	status: TaskGroupStatus;
}

export type TaskStatus =
	| "pending"
	| "assigned"
	| "in_progress"
	| "in_review"
	| "completed"
	| "failed"
	| "blocked";

export type TaskPriority = "high" | "medium" | "low";

export interface Task {
	id: string;
	group_id: string;
	sequence: number;
	title: string;
	description: string;
	status: TaskStatus;
	priority: TaskPriority;
	assigned_to: string | null;
	branch_name: string | null;
	worktree_path: string | null;
	progress: number;
	progress_note: string | null;
	created_at: string;
	started_at: string | null;
	completed_at: string | null;
	merged_at: string | null;
}

export interface TaskDependency {
	task_id: string;
	depends_on: string;
}

export type OwnershipType = "exclusive" | "shared";

export interface TaskFileOwnership {
	task_id: string;
	file_pattern: string;
	ownership_type: OwnershipType;
}

export type ProgressEvent =
	| "claimed"
	| "started"
	| "progress_update"
	| "rebased"
	| "completed"
	| "failed"
	| "merged"
	| "conflict_detected";

export interface ProgressLog {
	id: string;
	task_id: string;
	timestamp: string;
	event: ProgressEvent;
	message: string;
	metadata: Record<string, unknown> | null;
}

// Tool input/output types

export interface CreateTasksInput {
	group_title: string;
	group_description: string;
	tasks: Array<{
		title: string;
		description: string;
		priority?: TaskPriority;
		depends_on?: number[];
		file_patterns?: Array<{
			pattern: string;
			ownership_type: OwnershipType;
		}>;
	}>;
}

export interface CreateTasksOutput {
	group_id: string;
	tasks: Array<{
		id: string;
		sequence: number;
		title: string;
		status: TaskStatus;
		can_start: boolean;
	}>;
	warnings: string[];
}

export interface ListTasksInput {
	group_id?: string;
	status?: TaskStatus[];
	include_progress?: boolean;
}

export interface ListTasksOutput {
	tasks: Array<{
		id: string;
		sequence: number;
		title: string;
		status: TaskStatus;
		progress: number;
		progress_note: string | null;
		assigned_to: string | null;
		branch_name: string | null;
		worktree_path: string | null;
		dependencies: Array<{
			sequence: number;
			title: string;
			status: TaskStatus;
		}>;
		can_start: boolean;
	}>;
	summary: {
		total: number;
		pending: number;
		in_progress: number;
		in_review: number;
		completed: number;
		blocked: number;
	};
}

export interface GetTaskInput {
	task_id: string;
}

export interface GetTaskOutput {
	task: Task;
	dependencies: Array<{
		sequence: number;
		title: string;
		status: TaskStatus;
	}>;
	file_ownership: TaskFileOwnership[];
	progress_logs: ProgressLog[];
}

export interface ClaimTaskInput {
	task_id: string;
	agent_id?: string;
}

export interface ClaimTaskOutput {
	success: boolean;
	task: Task;
	error?: string;
}

export interface StartTaskInput {
	task_id: string;
}

export interface StartTaskOutput {
	success: boolean;
	worktree_path: string;
	branch_name: string;
	task: Task;
	context: {
		description: string;
		file_patterns: string[];
		dependencies_completed: Array<{
			title: string;
			branch_name: string;
		}>;
	};
}

export interface UpdateProgressInput {
	task_id: string;
	progress: number;
	note: string;
	files_changed?: string[];
}

export interface UpdateProgressOutput {
	success: boolean;
	conflict_warnings: string[];
	rebase_recommended: boolean;
}

export interface CompleteTaskInput {
	task_id: string;
	summary: string;
	files_changed: string[];
}

export interface CompleteTaskOutput {
	success: boolean;
	task: Task;
	unlocked_tasks: Array<{
		sequence: number;
		title: string;
	}>;
}

export type MergeStrategy = "merge" | "squash";

export interface MergeTaskInput {
	task_id: string;
	strategy?: MergeStrategy;
}

export interface MergeTaskOutput {
	success: boolean;
	merge_result: "clean" | "auto_resolved" | "conflict";
	conflicts?: Array<{
		file: string;
		description: string;
		auto_resolvable: boolean;
		suggestion?: string;
	}>;
	unlocked_tasks: Array<{
		sequence: number;
		title: string;
		can_start: boolean;
	}>;
}

export interface CleanupTaskInput {
	task_id: string;
	reason?: string;
}

export interface CleanupTaskOutput {
	success: boolean;
	cleaned: {
		worktree_removed: boolean;
		branch_removed: boolean;
	};
}
