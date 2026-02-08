# agents-task-assigning

MCP Server for multi-agent task assignment and coordination. Enables multiple Claude Code agents to work in parallel on the same project — each in its own git worktree, with DAG-based dependency tracking and file conflict prevention.

## How It Works

```
Coordinator (main branch)
  │
  ├─ create_tasks ──► SQLite DB (.tasks/tasks.db)
  │                        │
  │    ┌───────────────────┼───────────────────┐
  │    ▼                   ▼                   ▼
  │  Agent #1            Agent #2            Agent #3
  │  claim → start       claim → start       claim → start
  │  .worktrees/task-1   .worktrees/task-2   .worktrees/task-3
  │  task/task-1-*       task/task-2-*       task/task-3-*
  │    │                   │                   │
  │    ▼                   ▼                   ▼
  │  complete             complete            complete
  │    │                   │                   │
  └────┴───── merge ◄──────┴───────────────────┘
```

1. **Coordinator** splits work into a task group with dependencies and file ownership
2. **Agents** in separate sessions claim, start, and work on tasks — each in an isolated git worktree
3. **Coordinator** merges completed branches back, with automatic conflict detection

## Quick Start

One command to set up everything in your project:

```bash
npx agents-task-assigning init      # or: npx ata init
```

This will:

- Create `.mcp.json` with the MCP server config (or merge into existing)
- Add `.tasks/` and `.worktrees/` to `.gitignore`

That's it. Open Claude Code and start assigning tasks.

### Manual Setup

If you prefer to configure manually, add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "task-assigner": {
      "command": "npx",
      "args": ["-y", "agents-task-assigning"]
    }
  }
}
```

## MCP Tools

### Task Management

#### `create_tasks`

Create a task group with dependencies and file ownership rules.

```json
{
  "group_title": "Blog System",
  "group_description": "Build a full blog with auth",
  "tasks": [
    {
      "title": "DB Schema",
      "description": "Create database schema and migrations",
      "priority": "high",
      "file_patterns": [
        { "pattern": "src/db/**", "ownership_type": "exclusive" }
      ]
    },
    {
      "title": "Auth System",
      "description": "JWT-based authentication",
      "file_patterns": [
        { "pattern": "src/auth/**", "ownership_type": "exclusive" }
      ]
    },
    {
      "title": "CRUD API",
      "description": "Blog post CRUD endpoints",
      "depends_on": [1, 2],
      "file_patterns": [
        { "pattern": "src/api/**", "ownership_type": "exclusive" }
      ]
    }
  ]
}
```

- `depends_on` uses 1-based sequence numbers
- Tasks with unmet dependencies start in `blocked` status
- File pattern overlaps with `exclusive` ownership generate warnings
- DAG is validated for cycles on creation

#### `list_tasks`

List tasks with optional filters. Returns computed `can_start` status and summary counts.

```json
{
  "group_id": "...",
  "status": ["pending", "in_progress"]
}
```

#### `get_task`

Get full task details including dependencies, file ownership, and progress logs.

```json
{
  "task_id": "..."
}
```

### Agent Workflow

#### `claim_task`

Claim a pending task. Validates dependencies are met and no file ownership conflicts exist.

```json
{
  "task_id": "...",
  "agent_id": "agent-frontend"
}
```

#### `start_task`

Create a git worktree and branch, then start working. Returns the worktree path and task context.

```json
{
  "task_id": "..."
}
```

Creates:

- Branch: `task/task-{seq}-{slug}` (e.g. `task/task-1-db-schema`)
- Worktree: `.worktrees/task-{seq}-{slug}`

#### `update_progress`

Report progress. Checks for file conflicts with other in-progress tasks and recommends rebase when main has new commits.

```json
{
  "task_id": "...",
  "progress": 75,
  "note": "Schema complete, seeding data",
  "files_changed": ["src/db/schema.ts", "src/db/seed.ts"]
}
```

#### `complete_task`

Mark task as done (moves to `in_review`). Automatically unlocks downstream tasks whose dependencies are now met.

```json
{
  "task_id": "...",
  "summary": "Schema and migrations complete",
  "files_changed": ["src/db/schema.ts", "src/db/migrations/001.sql"]
}
```

### Integration

#### `merge_task`

Merge a completed task's branch into main. Supports `merge` and `squash` strategies. On success, cleans up the worktree and branch automatically.

```json
{
  "task_id": "...",
  "strategy": "squash"
}
```

If conflicts occur, returns the conflicted files with resolution suggestions.

#### `cleanup_task`

Remove a task's worktree and branch, mark it as failed. Use for abandoned or broken tasks.

```json
{
  "task_id": "...",
  "reason": "Approach changed, splitting into smaller tasks"
}
```

## Task State Machine

```
pending ──► assigned ──► in_progress ──► in_review ──► completed
                │              │              │
                ▼              ▼              ▼
             failed         failed         failed
                               ▲
blocked ───────────────────────┘
  (auto-unblocks when deps complete)
```

## File Ownership

Prevents merge conflicts before they happen:

- **`exclusive`** — Only one task can modify files matching this pattern. Other tasks attempting to claim overlapping patterns will be rejected.
- **`shared`** — Multiple tasks can modify these files, but warnings are generated during progress updates if conflicts are detected.

Patterns use prefix matching (e.g. `src/db/**` matches `src/db/schema.ts`).

## Configuration

### Database Location

Default: `.tasks/tasks.db` in the current working directory.

Override with environment variable:

```json
{
  "mcpServers": {
    "task-assigner": {
      "command": "npx",
      "args": ["-y", "agents-task-assigning"],
      "env": {
        "TASK_DB_PATH": "/path/to/custom/tasks.db"
      }
    }
  }
}
```

### Git

The server auto-detects the git repository root. Worktrees are created under `.worktrees/` in the repo root. Add to your `.gitignore`:

```
.tasks/
.worktrees/
```

## Example Workflow

### Session 1 — Coordinator

```
You: Split this into parallel tasks: build a blog with auth, DB, and API

Claude uses create_tasks → creates 3 tasks, task 3 depends on 1 and 2

You: What's the status?

Claude uses list_tasks → shows task 1 and 2 ready, task 3 blocked
```

### Session 2 — Agent A

```
Agent: I'll work on the DB Schema task

Claude uses claim_task → assigned
Claude uses start_task → worktree at .worktrees/task-1-db-schema

(works in worktree, commits code)

Claude uses update_progress → 80%, no conflicts
Claude uses complete_task → moved to in_review, task 3 still blocked (needs task 2)
```

### Session 3 — Agent B

```
Agent: I'll take the Auth System task

Claude uses claim_task → assigned
Claude uses start_task → worktree at .worktrees/task-2-auth-system

(works in worktree, commits code)

Claude uses complete_task → moved to in_review, task 3 now unlocked!
```

### Back to Session 1 — Coordinator

```
You: Merge the completed tasks

Claude uses merge_task for task 1 → clean merge, worktree cleaned up
Claude uses merge_task for task 2 → clean merge, worktree cleaned up

You: Start task 3

(Agent C can now claim and start the CRUD API task)
```

## CLI

```
Usage: ata <command>

Commands:
  init     Set up agents-task-assigning in the current project
           Creates .mcp.json, updates .gitignore

  help     Show this help message
```

`ata init` is smart about existing configs:

| Scenario                                | Behavior                             |
| --------------------------------------- | ------------------------------------ |
| No `.mcp.json`                          | Creates new file                     |
| `.mcp.json` exists with other servers   | Merges `task-assigner` in            |
| `.mcp.json` already has `task-assigner` | Skips (no overwrite)                 |
| Invalid `.mcp.json`                     | Skips with warning                   |
| No `.gitignore` (git repo)              | Creates with `.tasks/` `.worktrees/` |
| `.gitignore` missing entries            | Appends only the missing ones        |
| `.gitignore` already complete           | Skips                                |
| Not a git repo                          | Skips `.gitignore`                   |

## Development

```bash
pnpm install
pnpm test        # run tests (89 tests)
pnpm build       # build to dist/
```

## License

MIT
