import type { TaskFileOwnership, Task } from "../types/index.js";

export class ConflictService {
	/**
	 * Check if two glob patterns could overlap.
	 * Simple heuristic: check if one pattern is a prefix of another
	 * after removing glob suffixes like **, *.
	 */
	patternsOverlap(pattern1: string, pattern2: string): boolean {
		const normalize = (p: string): string =>
			p
				.replace(/\*\*\/?/g, "")
				.replace(/\*/g, "")
				.replace(/\/+$/, "");

		const base1 = normalize(pattern1);
		const base2 = normalize(pattern2);

		// If either base is empty (e.g., "**"), it matches everything
		if (base1.length === 0 || base2.length === 0) {
			return true;
		}

		// Check if one is a prefix of the other
		return base1.startsWith(base2) || base2.startsWith(base1);
	}

	/**
	 * Find potential conflicts between a task's file patterns and other in-progress tasks.
	 * Only exclusive patterns cause conflicts.
	 */
	findConflicts(
		taskPatterns: TaskFileOwnership[],
		otherTasks: Array<{ task: Task; patterns: TaskFileOwnership[] }>,
	): Array<{
		task: Task;
		conflicting_pattern: string;
		ownership_type: string;
	}> {
		const conflicts: Array<{
			task: Task;
			conflicting_pattern: string;
			ownership_type: string;
		}> = [];

		for (const myOwnership of taskPatterns) {
			for (const other of otherTasks) {
				for (const otherOwnership of other.patterns) {
					// Conflict if either side claims exclusive ownership on overlapping patterns
					if (
						(myOwnership.ownership_type === "exclusive" ||
							otherOwnership.ownership_type === "exclusive") &&
						this.patternsOverlap(
							myOwnership.file_pattern,
							otherOwnership.file_pattern,
						)
					) {
						conflicts.push({
							task: other.task,
							conflicting_pattern: otherOwnership.file_pattern,
							ownership_type: otherOwnership.ownership_type,
						});
					}
				}
			}
		}

		return conflicts;
	}

	/**
	 * Check if a specific file matches any of the given patterns.
	 * Uses simple string matching: startsWith for directory patterns (ending with ** or *).
	 */
	fileMatchesPatterns(filePath: string, patterns: string[]): boolean {
		for (const pattern of patterns) {
			// Remove trailing glob suffixes to get directory prefix
			const base = pattern.replace(/\*\*\/?$/, "").replace(/\*$/, "");

			if (base.length === 0) {
				// Pattern like "**" matches everything
				return true;
			}

			if (filePath.startsWith(base)) {
				return true;
			}

			// Exact match
			if (filePath === pattern) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Check changed files against other tasks' exclusive patterns.
	 * Returns warning messages for any files that conflict.
	 */
	checkFileConflicts(
		changedFiles: string[],
		otherTasks: Array<{ task: Task; patterns: TaskFileOwnership[] }>,
	): string[] {
		const warnings: string[] = [];

		for (const file of changedFiles) {
			for (const other of otherTasks) {
				const exclusivePatterns = other.patterns
					.filter((p) => p.ownership_type === "exclusive")
					.map((p) => p.file_pattern);

				if (this.fileMatchesPatterns(file, exclusivePatterns)) {
					warnings.push(
						`File "${file}" conflicts with task #${other.task.sequence} "${other.task.title}" which has exclusive ownership`,
					);
				}
			}
		}

		return warnings;
	}
}

// Export singleton instance
export const conflictService = new ConflictService();
