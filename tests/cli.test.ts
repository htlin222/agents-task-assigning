import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runInit } from "../src/cli.js";

function makeTmpDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "ata-test-"));
}

function cleanup(dir: string) {
	fs.rmSync(dir, { recursive: true, force: true });
}

describe("ata init", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		cleanup(tmpDir);
	});

	// ── .mcp.json ──────────────────────────────────────────────────────

	describe(".mcp.json", () => {
		it("creates .mcp.json when none exists", () => {
			// needs a package.json so findProjectRoot stops here
			fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");

			const result = runInit(tmpDir);

			expect(result.mcpJson).toBe("created");

			const content = JSON.parse(
				fs.readFileSync(path.join(tmpDir, ".mcp.json"), "utf-8"),
			);
			expect(content.mcpServers["task-assigner"]).toBeDefined();
			expect(content.mcpServers["task-assigner"].command).toBe("npx");
		});

		it("merges into existing .mcp.json with other servers", () => {
			fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
			fs.writeFileSync(
				path.join(tmpDir, ".mcp.json"),
				JSON.stringify({
					mcpServers: {
						"other-server": { command: "other", args: [] },
					},
				}),
			);

			const result = runInit(tmpDir);

			expect(result.mcpJson).toBe("merged");

			const content = JSON.parse(
				fs.readFileSync(path.join(tmpDir, ".mcp.json"), "utf-8"),
			);
			expect(content.mcpServers["other-server"]).toBeDefined();
			expect(content.mcpServers["task-assigner"]).toBeDefined();
		});

		it("skips when task-assigner already configured", () => {
			fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
			fs.writeFileSync(
				path.join(tmpDir, ".mcp.json"),
				JSON.stringify({
					mcpServers: {
						"task-assigner": {
							command: "npx",
							args: ["-y", "agents-task-assigning"],
						},
					},
				}),
			);

			const result = runInit(tmpDir);

			expect(result.mcpJson).toBe("skipped");
			expect(result.warnings.length).toBeGreaterThan(0);
			expect(result.warnings[0]).toContain("already has");
		});

		it("skips when .mcp.json is invalid JSON", () => {
			fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
			fs.writeFileSync(path.join(tmpDir, ".mcp.json"), "not json {{{");

			const result = runInit(tmpDir);

			expect(result.mcpJson).toBe("skipped");
			expect(result.warnings[0]).toContain("not valid JSON");
		});
	});

	// ── .gitignore ─────────────────────────────────────────────────────

	describe(".gitignore", () => {
		it("creates .gitignore in a git repo", () => {
			fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
			fs.mkdirSync(path.join(tmpDir, ".git"));

			const result = runInit(tmpDir);

			expect(result.gitignore).toBe("created");

			const content = fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf-8");
			expect(content).toContain(".tasks/");
			expect(content).toContain(".worktrees/");
			expect(content).toContain("# agents-task-assigning");
		});

		it("appends to existing .gitignore when entries missing", () => {
			fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
			fs.mkdirSync(path.join(tmpDir, ".git"));
			fs.writeFileSync(
				path.join(tmpDir, ".gitignore"),
				"node_modules/\ndist/\n",
			);

			const result = runInit(tmpDir);

			expect(result.gitignore).toBe("updated");

			const content = fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf-8");
			expect(content).toContain("node_modules/");
			expect(content).toContain(".tasks/");
			expect(content).toContain(".worktrees/");
		});

		it("skips when all entries already present", () => {
			fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
			fs.mkdirSync(path.join(tmpDir, ".git"));
			fs.writeFileSync(
				path.join(tmpDir, ".gitignore"),
				"node_modules/\n.tasks/\n.worktrees/\n",
			);

			const result = runInit(tmpDir);

			expect(result.gitignore).toBe("skipped");
		});

		it("only appends missing entries", () => {
			fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
			fs.mkdirSync(path.join(tmpDir, ".git"));
			fs.writeFileSync(
				path.join(tmpDir, ".gitignore"),
				"node_modules/\n.tasks/\n",
			);

			const result = runInit(tmpDir);

			expect(result.gitignore).toBe("updated");

			const content = fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf-8");
			// .tasks/ should appear only once (original)
			const tasksCount = (content.match(/\.tasks\//g) || []).length;
			expect(tasksCount).toBe(1);
			// .worktrees/ should have been appended
			expect(content).toContain(".worktrees/");
		});

		it("reports not_git_repo when no .git directory", () => {
			fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");

			const result = runInit(tmpDir);

			expect(result.gitignore).toBe("not_git_repo");
		});
	});

	// ── Project root detection ─────────────────────────────────────────

	describe("project root detection", () => {
		it("finds root by package.json", () => {
			fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
			const sub = path.join(tmpDir, "src", "deep");
			fs.mkdirSync(sub, { recursive: true });

			const result = runInit(sub);

			expect(result.root).toBe(tmpDir);
		});

		it("finds root by .git", () => {
			fs.mkdirSync(path.join(tmpDir, ".git"));
			const sub = path.join(tmpDir, "src");
			fs.mkdirSync(sub, { recursive: true });

			const result = runInit(sub);

			expect(result.root).toBe(tmpDir);
		});
	});
});
