export class DagService {
	/**
	 * Validate that adding dependencies won't create a cycle.
	 * Uses DFS-based cycle detection.
	 */
	validateNoCycles(dependencies: Map<string, string[]>): {
		valid: boolean;
		cycle?: string[];
	} {
		const WHITE = 0; // unvisited
		const GRAY = 1; // in current DFS path
		const BLACK = 2; // fully processed

		const color = new Map<string, number>();

		// Initialize all nodes
		for (const [node, deps] of dependencies) {
			color.set(node, WHITE);
			for (const dep of deps) {
				if (!color.has(dep)) {
					color.set(dep, WHITE);
				}
			}
		}

		const parent = new Map<string, string | null>();

		const dfs = (node: string): string[] | null => {
			color.set(node, GRAY);

			const neighbors = dependencies.get(node) ?? [];
			for (const neighbor of neighbors) {
				const neighborColor = color.get(neighbor) ?? WHITE;

				if (neighborColor === GRAY) {
					// Found a cycle - reconstruct it
					const cycle: string[] = [neighbor, node];
					let current = node;
					while (
						parent.get(current) !== null &&
						parent.get(current) !== neighbor
					) {
						current = parent.get(current)!;
						cycle.push(current);
					}
					cycle.reverse();
					return cycle;
				}

				if (neighborColor === WHITE) {
					parent.set(neighbor, node);
					const result = dfs(neighbor);
					if (result) return result;
				}
			}

			color.set(node, BLACK);
			return null;
		};

		for (const node of color.keys()) {
			if (color.get(node) === WHITE) {
				parent.set(node, null);
				const cycle = dfs(node);
				if (cycle) {
					return { valid: false, cycle };
				}
			}
		}

		return { valid: true };
	}

	/**
	 * Get topological order of tasks using Kahn's algorithm.
	 */
	topologicalSort(dependencies: Map<string, string[]>): string[] {
		// Build in-degree map and collect all nodes
		const inDegree = new Map<string, number>();
		const adjacency = new Map<string, string[]>();

		// Collect all nodes
		for (const [node, deps] of dependencies) {
			if (!inDegree.has(node)) {
				inDegree.set(node, 0);
			}
			if (!adjacency.has(node)) {
				adjacency.set(node, []);
			}
			for (const dep of deps) {
				if (!inDegree.has(dep)) {
					inDegree.set(dep, 0);
				}
				if (!adjacency.has(dep)) {
					adjacency.set(dep, []);
				}
			}
		}

		// Build adjacency: dep -> [nodes that depend on dep]
		// and compute in-degrees
		for (const [node, deps] of dependencies) {
			inDegree.set(node, (inDegree.get(node) ?? 0) + deps.length);
			for (const dep of deps) {
				const adj = adjacency.get(dep) ?? [];
				adj.push(node);
				adjacency.set(dep, adj);
			}
		}

		// Start with nodes that have no dependencies (in-degree 0)
		const queue: string[] = [];
		for (const [node, degree] of inDegree) {
			if (degree === 0) {
				queue.push(node);
			}
		}

		const result: string[] = [];

		while (queue.length > 0) {
			const node = queue.shift()!;
			result.push(node);

			const neighbors = adjacency.get(node) ?? [];
			for (const neighbor of neighbors) {
				const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
				inDegree.set(neighbor, newDegree);
				if (newDegree === 0) {
					queue.push(neighbor);
				}
			}
		}

		// If result doesn't contain all nodes, there's a cycle
		if (result.length !== inDegree.size) {
			throw new Error(
				"Cannot perform topological sort: graph contains a cycle",
			);
		}

		return result;
	}

	/**
	 * Check if a task can start (all dependencies completed).
	 */
	canStart(
		taskId: string,
		dependencies: Map<string, string[]>,
		completedTasks: Set<string>,
	): boolean {
		const deps = dependencies.get(taskId) ?? [];
		return deps.every((dep) => completedTasks.has(dep));
	}

	/**
	 * Get all tasks that would be unlocked if a given task is completed.
	 * A task is unlocked when ALL of its dependencies are in the completed set.
	 */
	getUnlockedTasks(
		completedTaskId: string,
		allDependencies: Map<string, string[]>,
		completedTasks: Set<string>,
	): string[] {
		// Create a new completed set that includes the newly completed task
		const newCompleted = new Set(completedTasks);
		newCompleted.add(completedTaskId);

		const unlocked: string[] = [];

		for (const [taskId, deps] of allDependencies) {
			// Skip if already completed or if it doesn't depend on the completed task
			if (newCompleted.has(taskId)) continue;
			if (!deps.includes(completedTaskId)) continue;

			// Check if all dependencies are now met
			if (deps.every((dep) => newCompleted.has(dep))) {
				unlocked.push(taskId);
			}
		}

		return unlocked;
	}
}

// Export singleton instance
export const dagService = new DagService();
