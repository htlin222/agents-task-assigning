import { execSync } from "node:child_process";

export class GitService {
	constructor(private repoRoot: string) {}

	/**
	 * Get the repo root directory.
	 */
	static getRepoRoot(): string {
		try {
			return execSync("git rev-parse --show-toplevel", {
				encoding: "utf-8",
				stdio: "pipe",
			}).trim();
		} catch (error) {
			throw new Error(
				`Failed to determine git repo root: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Create a new worktree with a new branch.
	 */
	createWorktree(worktreePath: string, branchName: string): void {
		try {
			execSync(`git worktree add "${worktreePath}" -b "${branchName}"`, {
				cwd: this.repoRoot,
				encoding: "utf-8",
				stdio: "pipe",
			});
		} catch (error) {
			throw new Error(
				`Failed to create worktree at ${worktreePath} with branch ${branchName}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Remove a worktree.
	 */
	removeWorktree(worktreePath: string): void {
		try {
			execSync(`git worktree remove "${worktreePath}" --force`, {
				cwd: this.repoRoot,
				encoding: "utf-8",
				stdio: "pipe",
			});
		} catch (error) {
			throw new Error(
				`Failed to remove worktree at ${worktreePath}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Delete a branch.
	 */
	deleteBranch(branchName: string): void {
		try {
			execSync(`git branch -D "${branchName}"`, {
				cwd: this.repoRoot,
				encoding: "utf-8",
				stdio: "pipe",
			});
		} catch (error) {
			throw new Error(
				`Failed to delete branch ${branchName}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Get current branch name.
	 */
	getCurrentBranch(): string {
		try {
			return execSync("git rev-parse --abbrev-ref HEAD", {
				cwd: this.repoRoot,
				encoding: "utf-8",
				stdio: "pipe",
			}).trim();
		} catch (error) {
			throw new Error(
				`Failed to get current branch: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Check if we're on the main/master branch.
	 */
	isOnMainBranch(): boolean {
		const branch = this.getCurrentBranch();
		return branch === "main" || branch === "master";
	}

	/**
	 * Get the latest commit hash on a branch.
	 */
	getLatestCommit(branch?: string): string {
		try {
			const ref = branch ?? "HEAD";
			return execSync(`git rev-parse "${ref}"`, {
				cwd: this.repoRoot,
				encoding: "utf-8",
				stdio: "pipe",
			}).trim();
		} catch (error) {
			throw new Error(
				`Failed to get latest commit${branch ? ` for branch ${branch}` : ""}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Check if a worktree path exists in the list of worktrees.
	 */
	worktreeExists(worktreePath: string): boolean {
		try {
			const output = execSync("git worktree list --porcelain", {
				cwd: this.repoRoot,
				encoding: "utf-8",
				stdio: "pipe",
			});
			return output.includes(worktreePath);
		} catch {
			return false;
		}
	}

	/**
	 * Merge a branch (squash or regular).
	 * Returns success status and any conflicted files.
	 */
	mergeBranch(
		branchName: string,
		strategy: "merge" | "squash",
	): { success: boolean; conflicts: string[] } {
		try {
			const cmd =
				strategy === "squash"
					? `git merge --squash "${branchName}"`
					: `git merge "${branchName}" --no-edit`;

			execSync(cmd, {
				cwd: this.repoRoot,
				encoding: "utf-8",
				stdio: "pipe",
			});

			return { success: true, conflicts: [] };
		} catch {
			// Check if there are conflicts
			const conflicts = this.getConflictedFiles();
			if (conflicts.length > 0) {
				return { success: false, conflicts };
			}
			// If no conflicts detected, it was a different kind of error
			throw new Error(`Failed to merge branch ${branchName}`);
		}
	}

	/**
	 * Abort a merge in progress.
	 */
	abortMerge(): void {
		try {
			execSync("git merge --abort", {
				cwd: this.repoRoot,
				encoding: "utf-8",
				stdio: "pipe",
			});
		} catch (error) {
			throw new Error(
				`Failed to abort merge: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Get list of conflicted files.
	 */
	getConflictedFiles(): string[] {
		try {
			const output = execSync("git diff --name-only --diff-filter=U", {
				cwd: this.repoRoot,
				encoding: "utf-8",
				stdio: "pipe",
			});
			return output
				.trim()
				.split("\n")
				.filter((f) => f.length > 0);
		} catch {
			return [];
		}
	}

	/**
	 * Check if main branch has new commits since a given commit hash.
	 */
	hasNewCommitsSince(commitHash: string): boolean {
		try {
			// Try main first, fall back to master
			let mainBranch = "main";
			try {
				execSync("git rev-parse --verify main", {
					cwd: this.repoRoot,
					encoding: "utf-8",
					stdio: "pipe",
				});
			} catch {
				mainBranch = "master";
			}

			const output = execSync(
				`git log --oneline "${commitHash}..${mainBranch}"`,
				{
					cwd: this.repoRoot,
					encoding: "utf-8",
					stdio: "pipe",
				},
			);
			return output.trim().length > 0;
		} catch {
			return false;
		}
	}
}

/**
 * Factory function to create a GitService instance.
 */
export function createGitService(repoRoot?: string): GitService {
	const root = repoRoot ?? GitService.getRepoRoot();
	return new GitService(root);
}
