import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

// ── ANSI colors ──────────────────────────────────────────────────────────────
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

// ── Constants ────────────────────────────────────────────────────────────────
const PACKAGE_NAME = "agents-task-assigning";
const MCP_JSON = ".mcp.json";
const GITIGNORE = ".gitignore";
const GITIGNORE_ENTRIES = [".tasks/", ".worktrees/"];

const MCP_CONFIG = {
	mcpServers: {
		"task-assigner": {
			command: "npx",
			args: ["-y", PACKAGE_NAME],
		},
	},
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function findProjectRoot(cwd: string): string {
	let dir = cwd;
	while (dir !== path.dirname(dir)) {
		if (
			fs.existsSync(path.join(dir, "package.json")) ||
			fs.existsSync(path.join(dir, ".git"))
		) {
			return dir;
		}
		dir = path.dirname(dir);
	}
	// fallback to cwd
	return cwd;
}

function isGitRepo(dir: string): boolean {
	return fs.existsSync(path.join(dir, ".git"));
}

function detectPackageManager(dir: string): "pnpm" | "npm" | "yarn" | "bun" {
	if (fs.existsSync(path.join(dir, "pnpm-lock.yaml"))) return "pnpm";
	if (fs.existsSync(path.join(dir, "yarn.lock"))) return "yarn";
	if (fs.existsSync(path.join(dir, "bun.lockb"))) return "bun";
	return "npm";
}

// ── Init logic (exported for testing) ────────────────────────────────────────

export interface InitResult {
	root: string;
	mcpJson: "created" | "merged" | "skipped";
	gitignore: "created" | "updated" | "skipped" | "not_git_repo";
	warnings: string[];
}

export function runInit(cwd: string): InitResult {
	const root = findProjectRoot(cwd);
	const warnings: string[] = [];
	let mcpJsonStatus: InitResult["mcpJson"] = "created";
	let gitignoreStatus: InitResult["gitignore"] = "created";

	// ── 1. .mcp.json ──────────────────────────────────────────────────────
	const mcpPath = path.join(root, MCP_JSON);

	if (fs.existsSync(mcpPath)) {
		try {
			const existing = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));

			if (existing?.mcpServers?.["task-assigner"]) {
				mcpJsonStatus = "skipped";
				warnings.push(
					`${MCP_JSON} already has "task-assigner" configured — skipped`,
				);
			} else {
				// merge into existing
				existing.mcpServers = existing.mcpServers || {};
				existing.mcpServers["task-assigner"] =
					MCP_CONFIG.mcpServers["task-assigner"];
				fs.writeFileSync(mcpPath, JSON.stringify(existing, null, "\t") + "\n");
				mcpJsonStatus = "merged";
			}
		} catch {
			mcpJsonStatus = "skipped";
			warnings.push(
				`${MCP_JSON} exists but is not valid JSON — skipped (please fix manually)`,
			);
		}
	} else {
		fs.writeFileSync(mcpPath, JSON.stringify(MCP_CONFIG, null, "\t") + "\n");
		mcpJsonStatus = "created";
	}

	// ── 2. .gitignore ─────────────────────────────────────────────────────
	if (!isGitRepo(root)) {
		gitignoreStatus = "not_git_repo";
	} else {
		const giPath = path.join(root, GITIGNORE);

		if (fs.existsSync(giPath)) {
			const content = fs.readFileSync(giPath, "utf-8");
			const lines = content.split("\n");
			const missing = GITIGNORE_ENTRIES.filter(
				(entry) => !lines.some((l) => l.trim() === entry),
			);

			if (missing.length === 0) {
				gitignoreStatus = "skipped";
			} else {
				const additions = missing.join("\n");
				const separator = content.endsWith("\n") ? "" : "\n";
				const section = `${separator}\n# agents-task-assigning\n${additions}\n`;
				fs.appendFileSync(giPath, section);
				gitignoreStatus = "updated";
			}
		} else {
			const section = `# agents-task-assigning\n${GITIGNORE_ENTRIES.join("\n")}\n`;
			fs.writeFileSync(giPath, section);
			gitignoreStatus = "created";
		}
	}

	return { root, mcpJson: mcpJsonStatus, gitignore: gitignoreStatus, warnings };
}

// ── CLI output ───────────────────────────────────────────────────────────────

function printBanner() {
	console.log();
	console.log(bold("  ⚡ ATA — Agents Task Assigning"));
	console.log(dim("  Multi-agent task coordination via MCP"));
	console.log();
}

function printResult(result: InitResult) {
	const icon = (
		status: "created" | "merged" | "updated" | "skipped" | "not_git_repo",
	) => {
		switch (status) {
			case "created":
				return green("✔ created");
			case "merged":
				return green("✔ merged");
			case "updated":
				return green("✔ updated");
			case "skipped":
				return yellow("— skipped");
			case "not_git_repo":
				return dim("— not a git repo");
		}
	};

	console.log(`  ${cyan("Project")}  ${result.root}`);
	console.log();
	console.log(`  ${cyan(MCP_JSON)}    ${icon(result.mcpJson)}`);
	console.log(`  ${cyan(GITIGNORE)}  ${icon(result.gitignore)}`);

	if (result.warnings.length > 0) {
		console.log();
		for (const w of result.warnings) {
			console.log(`  ${yellow("⚠")} ${w}`);
		}
	}

	console.log();
	console.log(dim("  Next: open Claude Code in this project — the MCP server"));
	console.log(dim("  will load automatically. Ask Claude to create_tasks."));
	console.log();
}

function printHelp() {
	console.log(`
${bold("Usage:")} ata <command>

${bold("Commands:")}
  ${cyan("init")}     Set up agents-task-assigning in the current project
           Creates ${MCP_JSON}, updates ${GITIGNORE}

  ${cyan("help")}     Show this help message

${bold("Examples:")}
  ${dim("$")} cd my-project
  ${dim("$")} ata init
`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
	const args = process.argv.slice(2);
	const command = args[0];

	switch (command) {
		case "init": {
			printBanner();
			try {
				const result = runInit(process.cwd());
				printResult(result);
			} catch (err) {
				console.error(red(`  ✖ Init failed: ${(err as Error).message}`));
				process.exit(1);
			}
			break;
		}
		case "help":
		case "--help":
		case "-h":
			printHelp();
			break;
		case undefined:
			printHelp();
			break;
		default:
			console.error(red(`Unknown command: ${command}`));
			printHelp();
			process.exit(1);
	}
}

main();
