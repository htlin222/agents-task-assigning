import { describe, it, expect } from "vitest";
import { dagService } from "../../src/services/dag-service.js";

describe("DagService", () => {
	describe("validateNoCycles", () => {
		it("returns valid for a DAG with no cycles", () => {
			const deps = new Map<string, string[]>([
				["A", ["B"]],
				["B", ["C"]],
			]);
			const result = dagService.validateNoCycles(deps);
			expect(result.valid).toBe(true);
			expect(result.cycle).toBeUndefined();
		});

		it("detects a simple cycle (A→B→A)", () => {
			const deps = new Map<string, string[]>([
				["A", ["B"]],
				["B", ["A"]],
			]);
			const result = dagService.validateNoCycles(deps);
			expect(result.valid).toBe(false);
			expect(result.cycle).toBeDefined();
			expect(result.cycle!.length).toBeGreaterThanOrEqual(2);
			expect(result.cycle).toContain("A");
			expect(result.cycle).toContain("B");
		});

		it("returns valid for a diamond dependency (A→B, A→C, B→D, C→D)", () => {
			const deps = new Map<string, string[]>([
				["A", ["B", "C"]],
				["B", ["D"]],
				["C", ["D"]],
			]);
			const result = dagService.validateNoCycles(deps);
			expect(result.valid).toBe(true);
			expect(result.cycle).toBeUndefined();
		});

		it("detects a self-referencing cycle (A→A)", () => {
			const deps = new Map<string, string[]>([["A", ["A"]]]);
			const result = dagService.validateNoCycles(deps);
			expect(result.valid).toBe(false);
			expect(result.cycle).toBeDefined();
			expect(result.cycle).toContain("A");
		});

		it("detects a complex cycle in a larger graph", () => {
			const deps = new Map<string, string[]>([
				["A", ["B"]],
				["B", ["C"]],
				["C", ["D"]],
				["D", ["B"]], // cycle: B→C→D→B
				["E", ["A"]],
			]);
			const result = dagService.validateNoCycles(deps);
			expect(result.valid).toBe(false);
			expect(result.cycle).toBeDefined();
			expect(result.cycle!.length).toBeGreaterThanOrEqual(2);
		});

		it("returns valid for an empty graph", () => {
			const deps = new Map<string, string[]>();
			const result = dagService.validateNoCycles(deps);
			expect(result.valid).toBe(true);
			expect(result.cycle).toBeUndefined();
		});
	});

	describe("topologicalSort", () => {
		it("produces correct order for a linear chain", () => {
			const deps = new Map<string, string[]>([
				["C", ["B"]],
				["B", ["A"]],
			]);
			const result = dagService.topologicalSort(deps);
			expect(result.indexOf("A")).toBeLessThan(result.indexOf("B"));
			expect(result.indexOf("B")).toBeLessThan(result.indexOf("C"));
		});

		it("produces a valid topological order for a diamond dependency", () => {
			const deps = new Map<string, string[]>([
				["D", ["B", "C"]],
				["B", ["A"]],
				["C", ["A"]],
			]);
			const result = dagService.topologicalSort(deps);
			// A must come before B and C; B and C must come before D
			expect(result.indexOf("A")).toBeLessThan(result.indexOf("B"));
			expect(result.indexOf("A")).toBeLessThan(result.indexOf("C"));
			expect(result.indexOf("B")).toBeLessThan(result.indexOf("D"));
			expect(result.indexOf("C")).toBeLessThan(result.indexOf("D"));
		});

		it("returns empty array for an empty graph", () => {
			const deps = new Map<string, string[]>();
			const result = dagService.topologicalSort(deps);
			expect(result).toEqual([]);
		});

		it("returns the single node for a single-node graph", () => {
			const deps = new Map<string, string[]>([["A", []]]);
			const result = dagService.topologicalSort(deps);
			expect(result).toEqual(["A"]);
		});
	});

	describe("canStart", () => {
		it("allows a task with no dependencies to start", () => {
			const deps = new Map<string, string[]>([["A", []]]);
			const completed = new Set<string>();
			expect(dagService.canStart("A", deps, completed)).toBe(true);
		});

		it("allows a task with all dependencies completed to start", () => {
			const deps = new Map<string, string[]>([["C", ["A", "B"]]]);
			const completed = new Set<string>(["A", "B"]);
			expect(dagService.canStart("C", deps, completed)).toBe(true);
		});

		it("blocks a task with some incomplete dependencies", () => {
			const deps = new Map<string, string[]>([["C", ["A", "B"]]]);
			const completed = new Set<string>(["A"]);
			expect(dagService.canStart("C", deps, completed)).toBe(false);
		});

		it("blocks a task when completed set is empty and it has dependencies", () => {
			const deps = new Map<string, string[]>([["B", ["A"]]]);
			const completed = new Set<string>();
			expect(dagService.canStart("B", deps, completed)).toBe(false);
		});
	});

	describe("getUnlockedTasks", () => {
		it("unlocks a dependent task when the completed task was its only dependency", () => {
			const deps = new Map<string, string[]>([["B", ["A"]]]);
			const completed = new Set<string>();
			const unlocked = dagService.getUnlockedTasks("A", deps, completed);
			expect(unlocked).toContain("B");
		});

		it("does not unlock a task that still has other unmet dependencies", () => {
			const deps = new Map<string, string[]>([["C", ["A", "B"]]]);
			const completed = new Set<string>();
			const unlocked = dagService.getUnlockedTasks("A", deps, completed);
			expect(unlocked).not.toContain("C");
		});

		it("unlocks multiple tasks at once", () => {
			const deps = new Map<string, string[]>([
				["B", ["A"]],
				["C", ["A"]],
			]);
			const completed = new Set<string>();
			const unlocked = dagService.getUnlockedTasks("A", deps, completed);
			expect(unlocked).toContain("B");
			expect(unlocked).toContain("C");
			expect(unlocked).toHaveLength(2);
		});

		it("returns empty array when no tasks depend on the completed task", () => {
			const deps = new Map<string, string[]>([["B", ["C"]]]);
			const completed = new Set<string>();
			const unlocked = dagService.getUnlockedTasks("A", deps, completed);
			expect(unlocked).toHaveLength(0);
		});
	});
});
