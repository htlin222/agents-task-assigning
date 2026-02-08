# Multi-Agent Task Assignment System — Architecture Design

> Date: 2026-02-08
> Tech Stack: TypeScript + MCP Server
> Purpose: 讓多個 Claude Code agent 能夠並行協作開發，透過 MCP Server 協調任務分配、進度追蹤、Git worktree 管理

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────┐
│                    User (Coordinator)                    │
│              主分支上的 Claude Code session               │
│         拆分任務 / 查看進度 / 合併分支 / 解衝突            │
└──────────────────────┬──────────────────────────────────┘
                       │ MCP Protocol (stdio)
                       ▼
┌─────────────────────────────────────────────────────────┐
│                  MCP Task Server                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐ │
│  │ Task Mgmt│ │ Git Mgmt │ │ Conflict │ │  Progress  │ │
│  │  Module   │ │  Module  │ │ Detector │ │  Tracker   │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └─────┬──────┘ │
│       └─────────┬───┴───────────┴──────────────┘        │
│                 ▼                                        │
│          ┌─────────────┐                                │
│          │   SQLite DB  │                                │
│          │  .tasks/db   │                                │
│          └─────────────┘                                │
└─────────────────────────────────────────────────────────┘
                       ▲
                       │ MCP Protocol (stdio)
          ┌────────────┼────────────┐
          ▼            ▼            ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │ Agent #1 │ │ Agent #2 │ │ Agent #3 │
    │ Session  │ │ Session  │ │ Session  │
    │ worktree │ │ worktree │ │ worktree │
    │  /task-1 │ │  /task-2 │ │  /task-3 │
    └──────────┘ └──────────┘ └──────────┘
```

每個 Claude Code session 都透過同一個 MCP Server 與中央 SQLite 資料庫互動。Server 負責任務調度、狀態管理、Git worktree 操作和衝突偵測。

---

## 2. Data Model

### 2.1 Task Group（任務群組）

一次「拆分任務」的請求產生一個 task group，包含多個 tasks。

```typescript
interface TaskGroup {
  id: string; // UUID
  title: string; // e.g. "Blog 系統開發"
  description: string; // 原始需求描述
  created_at: string; // ISO 8601
  status: "active" | "completed" | "archived";
}
```

### 2.2 Task（任務）

```typescript
interface Task {
  id: string; // UUID
  group_id: string; // FK → TaskGroup
  sequence: number; // 顯示用序號 (e.g. 1, 2, 3)
  title: string; // 簡短標題
  description: string; // 詳細描述，含具體要求
  status: TaskStatus;
  priority: "high" | "medium" | "low";
  assigned_to: string | null; // agent session identifier
  branch_name: string | null; // e.g. "task/task-001-db-schema"
  worktree_path: string | null; // e.g. ".worktrees/task-001-db-schema"
  progress: number; // 0-100
  progress_note: string | null; // 最新進度說明
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  merged_at: string | null;
}

type TaskStatus =
  | "pending" // 等待認領
  | "assigned" // 已認領，尚未開始
  | "in_progress" // 進行中
  | "in_review" // 完成等待 review
  | "completed" // 已合併完成
  | "failed" // 失敗
  | "blocked"; // 被依賴擋住
```

### 2.3 Task Dependency（依賴關係）

```typescript
interface TaskDependency {
  task_id: string; // 被擋住的任務
  depends_on: string; // 前置任務
}
```

DAG 結構：任務 C 依賴 A 和 B → 有兩筆記錄 `(C, A)` 和 `(C, B)`。
MCP Server 在 `claim_task` 時會驗證所有前置任務是否已 `completed`。

### 2.4 Task File Ownership（檔案擁有權）

用於衝突預防。在拆分任務時由 Claude 分析並建議。

```typescript
interface TaskFileOwnership {
  task_id: string;
  file_pattern: string; // glob pattern, e.g. "src/db/**"
  ownership_type: "exclusive" | "shared";
}
```

- `exclusive`: 只有該任務能修改這些檔案
- `shared`: 多個任務可能會碰，系統會在認領時發出警告

### 2.5 Progress Log（進度日誌）

```typescript
interface ProgressLog {
  id: string;
  task_id: string;
  timestamp: string;
  event:
    | "claimed"
    | "started"
    | "progress_update"
    | "rebased"
    | "completed"
    | "failed"
    | "merged"
    | "conflict_detected";
  message: string;
  metadata: Record<string, unknown> | null; // e.g. { files_changed: 5 }
}
```

---

## 3. SQLite Schema

```sql
CREATE TABLE task_groups (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES task_groups(id),
  sequence INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'medium',
  assigned_to TEXT,
  branch_name TEXT,
  worktree_path TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  progress_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  merged_at TEXT
);

CREATE TABLE task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  depends_on TEXT NOT NULL REFERENCES tasks(id),
  PRIMARY KEY (task_id, depends_on)
);

CREATE TABLE task_file_ownership (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  file_pattern TEXT NOT NULL,
  ownership_type TEXT NOT NULL DEFAULT 'exclusive',
  PRIMARY KEY (task_id, file_pattern)
);

CREATE TABLE progress_logs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  event TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata TEXT -- JSON string
);

CREATE INDEX idx_tasks_group ON tasks(group_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_deps_task ON task_dependencies(task_id);
CREATE INDEX idx_deps_depends ON task_dependencies(depends_on);
CREATE INDEX idx_logs_task ON progress_logs(task_id);
```

---

## 4. MCP Tools Design

### 4.1 Task Management Tools

#### `create_tasks`

從使用者的高層需求，建立一組任務。

```typescript
// Input
{
  group_title: string;
  group_description: string;
  tasks: Array<{
    title: string;
    description: string;
    priority?: 'high' | 'medium' | 'low';
    depends_on?: number[];       // 用 sequence number 參照
    file_patterns?: Array<{
      pattern: string;
      ownership_type: 'exclusive' | 'shared';
    }>;
  }>;
}

// Output
{
  group_id: string;
  tasks: Array<{
    id: string;
    sequence: number;
    title: string;
    status: string;
    can_start: boolean;          // 依賴是否已滿足
  }>;
  warnings: string[];            // e.g. 檔案擁有權重疊警告
}
```

#### `list_tasks`

```typescript
// Input
{
  group_id?: string;             // 篩選特定群組
  status?: TaskStatus[];         // 篩選狀態
  include_progress?: boolean;    // 包含進度日誌
}

// Output
{
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
    dependencies: Array<{ sequence: number; title: string; status: TaskStatus }>;
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
```

#### `get_task`

```typescript
// Input
{
  task_id: string;
}

// Output — 完整的 Task + dependencies + file_ownership + progress_logs
```

### 4.2 Agent Workflow Tools

#### `claim_task`

認領任務。會驗證依賴是否已滿足。

```typescript
// Input
{
  task_id: string;
  agent_id?: string;             // 可選，自動生成
}

// Output
{
  success: boolean;
  task: Task;
  error?: string;                // e.g. "依賴 Task #1 尚未完成"
}
```

**邏輯：**

1. 檢查任務狀態是否為 `pending`
2. 檢查所有 `depends_on` 的任務是否為 `completed`
3. 檢查檔案擁有權是否與其他 `in_progress` 任務衝突
4. 更新狀態為 `assigned`，寫入 `assigned_to`
5. 寫入 progress_log

#### `start_task`

開始任務，建立 Git worktree 和分支。

```typescript
// Input
{
  task_id: string;
}

// Output
{
  success: boolean;
  worktree_path: string;
  branch_name: string;
  task: Task;
  context: {
    description: string;         // 任務詳細描述
    file_patterns: string[];     // 建議修改的檔案範圍
    dependencies_completed: Array<{
      title: string;
      branch_name: string;       // 可參考已合併的變更
    }>;
  };
}
```

**邏輯：**

1. 確認任務狀態為 `assigned`
2. 生成 branch name: `task/task-{sequence}-{slugified-title}`
3. 生成 worktree path: `.worktrees/task-{sequence}-{slugified-title}`
4. 執行 `git worktree add <path> -b <branch>`
5. 更新任務的 `branch_name`, `worktree_path`, `started_at`
6. 狀態更新為 `in_progress`
7. 回傳任務上下文（描述、檔案範圍、已完成的依賴資訊）

#### `update_progress`

Agent 回報進度。

```typescript
// Input
{
  task_id: string;
  progress: number;              // 0-100
  note: string;                  // 進度說明
  files_changed?: string[];      // 已修改的檔案清單
}

// Output
{
  success: boolean;
  conflict_warnings: string[];   // 如果修改的檔案與其他任務重疊
  rebase_recommended: boolean;   // main 有新合併，建議 rebase
}
```

**邏輯：**

1. 更新 `progress` 和 `progress_note`
2. 檢查 `files_changed` 是否與其他 `in_progress` 任務的檔案擁有權重疊
3. 檢查 main 分支是否有新的合併（比較任務開始時的 commit hash）
4. 寫入 progress_log

#### `complete_task`

Agent 標記任務完成，進入 review 階段。

```typescript
// Input
{
  task_id: string;
  summary: string;               // 完成摘要
  files_changed: string[];       // 最終修改的檔案清單
}

// Output
{
  success: boolean;
  task: Task;
  unlocked_tasks: Array<{        // 因此任務完成而解鎖的後續任務
    sequence: number;
    title: string;
  }>;
}
```

**邏輯：**

1. 更新狀態為 `in_review`
2. 設定 `completed_at`
3. 檢查哪些下游任務的所有依賴現在都已滿足
4. 寫入 progress_log

### 4.3 Integration Tools

#### `merge_task`

合併任務分支回主分支。

```typescript
// Input
{
  task_id: string;
  strategy?: 'merge' | 'squash';  // 預設 squash
}

// Output
{
  success: boolean;
  merge_result: 'clean' | 'auto_resolved' | 'conflict';
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
```

**邏輯：**

1. 確認當前在主分支上
2. 確認任務狀態為 `in_review`
3. 執行 `git merge --squash <branch>` 或 `git merge <branch>`
4. 若有衝突：
   - 分析衝突檔案
   - 嘗試自動解決（語義不衝突的情況）
   - 無法自動解決的，回報給使用者
5. 合併成功後：
   - 更新狀態為 `completed`，設定 `merged_at`
   - 執行 `git worktree remove <path>`
   - 執行 `git branch -d <branch>`
   - 檢查並更新下游任務的可認領狀態
   - 寫入 progress_log

#### `cleanup_task`

手動清理任務（用於失敗或取消的任務）。

```typescript
// Input
{
  task_id: string;
  reason?: string;
}

// Output
{
  success: boolean;
  cleaned: {
    worktree_removed: boolean;
    branch_removed: boolean;
  };
}
```

---

## 5. Task State Machine

```
                    ┌─────────┐
                    │ pending │
                    └────┬────┘
                         │ claim_task
                         ▼
                    ┌──────────┐
          ┌─────── │ assigned │
          │        └────┬─────┘
          │             │ start_task
          │             ▼
          │       ┌─────────────┐
          │  ┌──> │ in_progress │ ◄──┐
          │  │    └──────┬──────┘    │
          │  │           │           │ unblock
          │  │           │      ┌────────┐
          │  │           ├─────>│ blocked│
          │  │           │      └────────┘
          │  │           │ complete_task
          │  │           ▼
          │  │    ┌───────────┐
          │  │    │ in_review │
          │  │    └─────┬─────┘
          │  │          │
          │  │    ┌─────┴──────┐
          │  │    ▼            ▼
          │  │ merge_task   reject (回到 in_progress)
          │  │    │
          │  │    ▼
          │  │ ┌───────────┐
          │  │ │ completed │
          │  │ └───────────┘
          │  │
          ▼  │
     ┌────────┐
     │ failed │  (任何階段都可能進入)
     └────────┘
```

### 狀態轉換規則

| 從          | 到          | 觸發          | 條件                            |
| ----------- | ----------- | ------------- | ------------------------------- |
| pending     | assigned    | claim_task    | 所有依賴已 completed            |
| pending     | blocked     | 自動          | 有依賴尚未 completed            |
| blocked     | pending     | 自動          | 所有依賴已 completed            |
| assigned    | in_progress | start_task    | —                               |
| assigned    | failed      | cleanup_task  | —                               |
| in_progress | in_review   | complete_task | —                               |
| in_progress | blocked     | 自動          | 依賴的任務被 revert（邊緣情境） |
| in_progress | failed      | cleanup_task  | —                               |
| in_review   | completed   | merge_task    | merge 成功                      |
| in_review   | in_progress | reject        | review 不通過                   |

---

## 6. Conflict Prevention & Resolution

### 6.1 預防層：檔案擁有權

在 `create_tasks` 時，Claude 分析需求並為每個任務標記檔案擁有權：

```
Task #1 (DB Schema):  src/db/**          [exclusive]
Task #2 (Auth):       src/auth/**        [exclusive]
Task #2 (Auth):       src/middleware/**   [exclusive]
Task #3 (CRUD API):   src/routes/**      [exclusive]
Task #3 (CRUD API):   src/db/queries/**  [shared] ⚠️
```

**規則：**

- `exclusive` 檔案只允許一個 `in_progress` 任務修改
- `shared` 檔案允許多任務修改，但 `claim_task` 時會發出警告
- `update_progress` 回報的 `files_changed` 會與擁有權比對

### 6.2 定期 Rebase

`update_progress` 會檢查 main 分支是否有新合併：

```typescript
// 在 update_progress 的回傳中
{
  rebase_recommended: true,
  rebase_reason: "Task #1 已合併到 main，建議 rebase 以取得最新變更"
}
```

Agent 收到 `rebase_recommended: true` 後，應執行：

1. `git fetch origin main`
2. `git rebase main`
3. 如果 rebase 成功，繼續工作
4. 如果 rebase 衝突，呼叫 `update_progress` 回報 `conflict_detected`

### 6.3 合併時解衝突

`merge_task` 遇到衝突時的處理流程：

1. **分析衝突類型：**
   - **新增 vs 新增**（雙方都新增了不同的內容）→ 通常可自動合併
   - **修改 vs 修改**（同一行被兩邊改了）→ 需要判斷
   - **刪除 vs 修改**（一邊刪了，另一邊改了）→ 需要人類決定

2. **自動解決嘗試：**
   - 如果衝突區塊在語義上不重疊（例如兩邊各自新增了不同的 import），自動合併
   - 如果無法確定，標記為需要人類處理

3. **回報格式：**

   ```
   ⚠️ 衝突無法自動解決：

   src/routes/index.ts:
     第 15 行：main 用 '/users'，Task #3 用 '/api/users'
     建議：使用 '/api/users'（Task #3 的 RESTful 風格更一致）

   要接受建議嗎？還是你想手動處理？
   ```

---

## 7. Project Structure

```
agents-task-assigning/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                 # MCP Server 入口
│   ├── server.ts                # MCP Server 設定與 tool 註冊
│   ├── db/
│   │   ├── connection.ts        # SQLite 連線管理
│   │   ├── schema.ts            # 建表與 migration
│   │   └── queries.ts           # 資料存取層
│   ├── tools/
│   │   ├── create-tasks.ts      # create_tasks tool
│   │   ├── list-tasks.ts        # list_tasks tool
│   │   ├── get-task.ts          # get_task tool
│   │   ├── claim-task.ts        # claim_task tool
│   │   ├── start-task.ts        # start_task tool
│   │   ├── update-progress.ts   # update_progress tool
│   │   ├── complete-task.ts     # complete_task tool
│   │   ├── merge-task.ts        # merge_task tool
│   │   └── cleanup-task.ts      # cleanup_task tool
│   ├── services/
│   │   ├── task-service.ts      # 任務業務邏輯（狀態機、依賴檢查）
│   │   ├── git-service.ts       # Git worktree 和分支操作
│   │   ├── conflict-service.ts  # 衝突偵測與檔案擁有權管理
│   │   └── dag-service.ts       # DAG 依賴圖的拓撲排序與驗證
│   └── types/
│       └── index.ts             # 所有 TypeScript 型別定義
├── tests/
│   ├── services/
│   │   ├── task-service.test.ts
│   │   ├── git-service.test.ts
│   │   ├── conflict-service.test.ts
│   │   └── dag-service.test.ts
│   └── tools/
│       └── *.test.ts
└── .tasks/                      # Runtime data (gitignored)
    └── tasks.db                 # SQLite database
```

---

## 8. Key Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "latest",
    "better-sqlite3": "latest",
    "slugify": "latest",
    "uuid": "latest"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "vitest": "latest",
    "@types/better-sqlite3": "latest",
    "@types/node": "latest",
    "tsup": "latest"
  }
}
```

**選擇理由：**

- `better-sqlite3`: 同步 API，適合 MCP tool 的 request-response 模型，且有良好的併發處理（WAL mode）
- `@modelcontextprotocol/sdk`: 官方 MCP SDK
- `tsup`: 輕量的 TypeScript bundler
- `vitest`: 快速的測試框架

---

## 9. MCP Server Configuration

使用者需要在 Claude Code 的 MCP 設定中加入此 server：

```json
// ~/.claude/mcp_servers.json 或專案的 .mcp.json
{
  "mcpServers": {
    "task-manager": {
      "command": "node",
      "args": ["<path-to-project>/dist/index.js"],
      "env": {
        "TASK_DB_PATH": "<project-root>/.tasks/tasks.db"
      }
    }
  }
}
```

每個 Claude Code session（包括 coordinator 和各個 agent）都需要連接同一個 MCP Server，存取同一個 SQLite 資料庫。

---

## 10. Agent Session Flow (Detailed)

### 10.1 Coordinator Session（主分支）

```
User ──"幫我拆分任務: 做一個 blog 系統"──> Claude
Claude ──分析 codebase──> Claude
Claude ──create_tasks({...})──> MCP Server
MCP Server ──寫入 DB + 回傳任務清單──> Claude
Claude ──呈現任務清單 + 警告──> User
User ──"OK" 或 "調整 #2"──> Claude
Claude ──(如需調整) update tasks──> MCP Server
```

### 10.2 Worker Agent Session（worktree）

```
User ──"接受任務"──> Claude
Claude ──list_tasks({status: ['pending']})──> MCP Server
MCP Server ──回傳可認領清單──> Claude
Claude ──呈現清單──> User
User ──"認領 #1"──> Claude
Claude ──claim_task({task_id: "..."})──> MCP Server
MCP Server ──驗證依賴 + 標記 assigned──> Claude
User ──"開始任務"──> Claude
Claude ──start_task({task_id: "..."})──> MCP Server
MCP Server ──建立 worktree + branch──> Claude
Claude ──切換到 worktree 目錄，開始工作──> ...
Claude ──(定期) update_progress({...})──> MCP Server
Claude ──(完成) complete_task({...})──> MCP Server
```

### 10.3 Resume Session（接續中斷的任務）

```
User ──"請列出正在進行的任務"──> Claude
Claude ──list_tasks({status: ['in_progress']})──> MCP Server
MCP Server ──回傳進行中任務──> Claude
Claude ──"Task #2 在 .worktrees/task-002-... 請 cd 過去開新 session"──> User
User ──(開新 session, cd 到 worktree)──> 新 Claude session
User ──"繼續任務"──> Claude
Claude ──get_task({task_id: "..."})──> MCP Server
MCP Server ──回傳完整任務上下文 + 進度日誌──> Claude
Claude ──從上次進度繼續工作──> ...
```

---

## 11. Edge Cases & Error Handling

### 11.1 Agent Session 中斷

- 任務狀態保持 `in_progress`，worktree 和分支保留
- 使用者可以透過 `list_tasks` 看到未完成的任務
- 新 session 可以 `cd` 到 worktree 繼續

### 11.2 Claim 競爭

- SQLite 的 WAL mode 提供足夠的併發控制
- `claim_task` 使用 transaction：`BEGIN IMMEDIATE` 確保原子性
- 如果兩個 agent 同時認領同一個任務，後者會收到「已被認領」的錯誤

### 11.3 依賴任務被 revert

- 如果已合併的任務需要 revert，手動將其狀態改回
- 系統自動將下游任務標記為 `blocked`

### 11.4 Worktree 路徑已存在

- `start_task` 會先檢查路徑是否已存在
- 如果存在（可能是之前的殘留），先清理再重建

### 11.5 合併時 main 已有新的合併

- `merge_task` 會先 `git pull` 確保 main 最新
- 然後再執行 merge

---

## 12. Future Considerations (Not in MVP)

以下功能不在首次實作範圍內，但設計上保留了擴展空間：

- **Web Dashboard**: 透過 HTTP API 提供即時任務面板
- **Webhook 通知**: 任務狀態變更時發送通知
- **任務模板**: 常見的拆分模式（CRUD、Auth、Frontend+Backend）
- **自動 rebase**: Agent 閒置時自動 rebase，而不只是建議
- **任務優先級排程**: 根據 priority 和依賴圖自動建議認領順序
- **多 repo 支援**: 跨 repo 的任務協調
