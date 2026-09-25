# 会话画布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 在 Webuddy 桌面端新增"会话画布"：无限画布上以实况卡片展示所有 agent 会话（含外部只读会话），呈现四类关系连线，并支持允许/拒绝、发消息、跳终端、拖线"传话 / 监督"。

**Architecture:** 渲染层新页面基于 `@xyflow/react`；数据全部来自已有来源（agent 状态存储、AI Vault、git status、编排 mailbox），只新增：状态存储的 `actionHistory` 环形缓冲、4 个主进程 IPC、一个纯函数图投影 `buildSessionGraph`。

**Tech Stack:** Electron（主进程 TS + vitest）、React 19 渲染层、zustand、`@xyflow/react`、pnpm。

**Spec:** `tools/webuddy-server/docs/2026-09-26-session-canvas-design.md`（实现方必读，本计划不重复其中的 UI 细节）

## Global Constraints

- AGENTS.md 全部规则：复用优先；注释只写简短 Why；文件 ≤300 行（不加 max-lines 豁免）；类型断言避免（必要时 `SAFETY:`）；文件名具体（禁止 utils/helpers）；跨平台（快捷键用平台判断、路径用 path）；SSH 场景考虑（远程会话照常显示，断连显示 `unverifiable`/"无法确认"，不显示为已结束）。
- UI 遵守 `docs/STYLEGUIDE.md`：用 `src/renderer/src/assets/main.css` 的 token 与 `components/ui/` 原语；不写裸调色板颜色；不拼接计算 className；`pnpm run check:code-quality:changed` 与 `pnpm lint` 的设计系统检查必须通过（本分支已有的 tools/webuddy-server/web 旧告警不算，自己改的文件必须零新增）。
- 画布代码目录：`src/renderer/src/components/session-canvas/`；纯逻辑模块以 `*-model.ts` 结尾放同目录，或跨进程共享的放 `src/shared/session-canvas-*.ts`。
- 新 IPC 统一返回 `{ ok: true, ... } | { ok: false, reason: string }`，渲染层失败用现有 toast（`sonner`）提示，不抛异常到 UI。
- 性能：只渲染可见元素（React Flow `onlyRenderVisibleElements`）；动作流每卡 ≤30 行；git status 仅对画布上出现的 worktree、页面可见时每 15 s；外部会话每 60 s；页面隐藏时停止轮询。
- 文案中文，走现有 i18n `translate(key, 默认中文)`；新增 key 需同步 `pnpm run sync:localization-catalog`，并确保 `verify:localization-catalog` / `verify:localization-extraction` 通过。
- 验证命令：`pnpm test <paths>`、`pnpm tc:node`、`pnpm tc:web`、`npx oxlint <files>`、`pnpm run check:code-quality:changed`。不在仓库根跑 `pnpm format`（只格式化自己改的文件，用 oxfmt）；不用 `--no-verify`；不用 `git stash`；只 `git add` 自己的路径。
- UI 验证（Task 7）：按 AGENTS.md "Electron UI Validation"，`ORCA_BACKGROUND_LAUNCH=1` 后台启动 + Playwright CDP 截图，不抢焦点、不 show 窗口；隔离 userData 与 `WEBUDDY_AGENT_HOME`。

---

### Task 1: 状态存储新增 `actionHistory`

**Files:** Modify `src/shared/agent-status-types.ts`（类型 + 常量）、`src/shared/agent-status-store-mutation.ts`（在写 `toolName`/`toolInput` 的同一路径追加）；若 mutation 文件超 300 行，把追加逻辑放新文件 `src/shared/agent-status-action-history.ts`。Test：同目录新测试文件。
**Produces:**
```ts
export type AgentActionHistoryEntry = { toolName: string; toolInput: string | null; at: number }
export const AGENT_ACTION_HISTORY_MAX = 30
// AgentStatusEntry 新增可选字段（旧快照/远端无此字段时视为 []）：
actionHistory?: AgentActionHistoryEntry[]
```
规则：同一 toolName+toolInput 连续重复只记一次；超出上限丢最旧；`toolInput` 截断 200 字符；会话边界（`sessionBoundary` 新会话）时清空。字段是可选新增，远端（SSH relay / 移动端）旧版本忽略它——确认 `docs/reference/remote-wire-compatibility.md` 对"新增可选字段"的要求并在测试里覆盖"无此字段的快照可正常处理"。
- [ ] 失败测试 → 实现 → `pnpm test src/shared/agent-status*`、`pnpm tc:node` → Commit `feat(agent-status): 记录最近动作流`

### Task 2: 主进程动作 IPC（发送 / 监督）
**Files:** Create `src/main/ipc/session-canvas-actions.ts`（+ test）、`src/preload/api/session-canvas-api.ts`（仿 `orca-profile-api.ts` + bridge 模式）、web 端 preload 桩（若类型要求）；Modify 注册处 `src/main/ipc/register-core-handlers/register-core-handlers.ts` 与 preload 聚合处。
**Produces（渲染层 `window.api.sessionCanvas`）：**
```ts
sendPrompt(args: { paneKey: string; text: string }): Promise<{ ok: true } | { ok: false; reason: string }>
supervise(args: { coordinatorPaneKey: string; workerPaneKey: string; task: string }): Promise<{ ok: true; dispatchId: string } | { ok: false; reason: string }>
```
- `sendPrompt`：paneKey → 终端句柄（找现有映射，如 agent 状态条目的 `terminalHandle`），调用 `runtime.sendTerminalAgentPrompt(handle, text)`（`src/main/runtime/orca-runtime-controller-knows-pty-is-live.ts`）。空文本 → `{ok:false}`。
- `supervise`：复用编排 worker-start 的**同一代码路径**（`startLocalWorker`，`src/main/runtime/rpc/methods/orchestration/worker/local-worker-start.ts`，带 `terminal: B 句柄`、`from: A 句柄`、`spec/task: task`），必要时为 A 创建或复用 run。不得复制编排逻辑；若需要，从 RPC 方法里抽出可被 IPC 调用的函数。`assertExplicitWorkerTerminalUsable` 的错误信息原样作为 `reason`。
- [ ] 测试：两个 IPC 的成功路径、未知 paneKey、空文本、监督校验失败原因透传（依赖注入 runtime / worker-start）。→ 实现 → 验证 → Commit `feat(session-canvas): 发送与监督 IPC`

### Task 3: 主进程数据 IPC（外部会话 / 消息记录）
**Files:** Create `src/main/ipc/session-canvas-data.ts`（+ test）；Modify Task 2 的 preload api 文件（追加方法）。
**Produces：**
```ts
listExternalSessions(): Promise<{ ok: true; sessions: SessionCanvasExternalSession[] } | { ok: false; reason: string }>
listMessages(args: { sinceMs: number }): Promise<{ ok: true; messages: SessionCanvasMessage[] } | { ok: false; reason: string }>
recordPassAlong(args: { fromPaneKey: string; toPaneKey: string }): Promise<{ ok: true }>
```
类型放 `src/shared/session-canvas-types.ts`：
```ts
export type SessionCanvasExternalSession = { key: string; agent: string; agentLabel: string; title: string; cwd: string | null; updatedAt: string | null; filePath: string; providerSessionId: string; preview: Array<{ role: string; text: string; timestamp: string | null }> }
export type SessionCanvasMessage = { fromPaneKey: string | null; toPaneKey: string | null; fromHandle: string | null; toHandle: string | null; at: number; kind: 'dispatch' | 'mailbox' | 'pass-along' }
```
- 外部会话：主进程调用 `listAiVaultSessions({ unlimited: false })`（`src/main/ai-vault/cached-session-list.ts`，共享 UI 缓存），取最近 7 天、最多 200 条，映射为上面的类型（preview 取最后 3 条 `previewMessages`，每条截断 300 字）。
- 消息：编排 mailbox 已投递消息的只读投影（`src/main/runtime/orchestration/db/messages/`），加上本地传话日志（`recordPassAlong` 写入 userData 下一个小 JSON，保留最近 200 条，原子写）。时间窗 `sinceMs`。
- [ ] 测试（注入依赖）：映射、7 天/200 条上限、传话日志上限与原子写、mailbox 投影。→ 实现 → 验证 → Commit `feat(session-canvas): 外部会话与消息数据 IPC`

### Task 4: 图投影模型（纯函数）
**Files:** Create `src/renderer/src/components/session-canvas/session-graph-model.ts`、`session-layout-model.ts`、`pass-along-prompt-model.ts`（+ 各自 `.test.ts`）。
**Consumes:** Task 1 类型、Task 3 类型、`DashboardCard`/`AgentStatusEntry`（`src/shared/dashboard-snapshot.ts`、`agent-status-types.ts`）。
**Produces：**
```ts
export type SessionCanvasInputs = {
  liveEntries: AgentStatusEntry[]           // 来自状态快照
  externalSessions: SessionCanvasExternalSession[]
  changedFilesByWorktree: Record<string, string[]>   // worktreeId → 已改文件（相对仓库根）
  repoIdByWorktree: Record<string, string>           // worktreeId → 仓库 id（同仓库才比较文件）
  messages: SessionCanvasMessage[]
  savedPositions: Record<string, { x: number; y: number }>
  filters: { query: string; agents: string[]; states: string[]; showExternal: boolean; hideIdleOlderThanMs: number | null }
  now: number
}
export type SessionNodeData = { kind: 'live'; entry: AgentStatusEntry; repoLabel: string | null } | { kind: 'external'; session: SessionCanvasExternalSession; repoLabel: string | null }
export type SessionEdgeKind = 'started' | 'messaged' | 'same-file'
export function buildSessionGraph(inputs: SessionCanvasInputs): {
  nodes: Array<{ id: string; type: 'live' | 'external' | 'group'; position: { x: number; y: number }; parentId?: string; data: SessionNodeData | { label: string } }>
  edges: Array<{ id: string; source: string; target: string; kind: SessionEdgeKind; animated: boolean; files?: string[] }>
}
// session-layout-model.ts
export function autoPlace(args: { existing: Map<string, {x:number;y:number}>; groupId: string; parentId?: string }): { x: number; y: number }
// pass-along-prompt-model.ts
export function composePassAlongPrompt(args: { fromTitle: string; result: string | null; note: string }): string
```
规则（均需测试）：节点 id：实况 `live:<paneKey>`，外部 `ext:<key>`；分组节点 `group:<repoId>`（无仓库归入"其他"）；外部会话与实况会话去重（同 agent 且 providerSessionId 或 transcript 路径相同 → 只保留实况）；started 边来自 `orchestration.parentPaneKey`/`coordinatorHandle` 与 dashboard `parentPaneKey`；messaged 边由消息记录去重合并，最近 10 分钟的 `animated: true`；same-file 边：同一仓库、不同会话、已改文件交集非空，`files` 为交集（最多 20）；已保存位置优先，否则 `autoPlace`（父会话右侧，否则分组网格下一个空位，卡片尺寸按 320×220 计）；筛选规则按 spec；`composePassAlongPrompt` 截断 result 到 4000 字、附言可空。
- [ ] 失败测试 → 实现 → `pnpm test src/renderer/src/components/session-canvas` → Commit `feat(session-canvas): 图投影与布局模型`

### Task 5: 画布页面骨架 + 数据接线
**Files:** 添加依赖 `@xyflow/react`（`pnpm add`，注意仓库 `minimumReleaseAge` 策略，选一个满足的版本）；Create `session-canvas/SessionCanvasPage.tsx`、`use-session-canvas-data.ts`（订阅状态快照、轮询外部会话/消息、按可见性轮询 git status、位置持久化读取）、`SessionCanvasToolbar.tsx`、`SessionGroupNode.tsx`、`SessionEdge.tsx`（三种样式，messaged 流动动画用 CSS，尊重 `prefers-reduced-motion`）；Modify `src/renderer/src/app-shell/AppWorkspaceShell.tsx`（懒加载页面 + view 值）、`src/renderer/src/components/sidebar/SidebarNav.tsx`（入口，默认显示）。节点暂用占位卡（Task 6 替换）。
**Consumes:** Task 3 `window.api.sessionCanvas.*`、Task 4 `buildSessionGraph`、`gitApi.status`、状态存储订阅（参考 dashboard 的现有订阅 hook，复用不要重写）。
**位置持久化：** 用现有持久化 UI 状态机制（参考 `use-persisted-ui-writer.ts`）或 localStorage（try/catch），键 `sessionCanvas.positions`，拖动结束时写入；"重新排列"清空。
- [ ] 测试：数据 hook（假 api：轮询间隔、页面隐藏停止）、页面渲染出分组与节点（mock React Flow 尺寸需要时用 ResizeObserver polyfill）。→ 实现 → `pnpm tc:web`、oxlint、code-quality → Commit `feat(session-canvas): 画布页面与数据接线`

### Task 6: 实况卡与只读卡
**Files:** Create `session-canvas/LiveSessionCard.tsx`、`ActionStream.tsx`、`SessionApprovalActions.tsx`、`SessionMessageComposer.tsx`、`ExternalSessionCard.tsx`（+ `.test.tsx`）；Modify 节点类型注册。
**复用：** 状态灯/agent 图标参考 `dashboard-popout/AgentKanbanCard.tsx`；跳终端用 `components/dashboard/reveal-dashboard-agent.ts`；审批选项用 `components/native-chat/native-chat-interactive-prompt.ts` 的 `parseApprovalFromStatus`（若只支持结构化 envelope，按 mobile `detectAgentPermission` 的逻辑补一个桌面版文本兜底放 `session-canvas/approval-fallback-model.ts`），点击发送按键走 `sendPrompt`（按键原样，如 `"1"` / ESC 的约定——查看 mobile 与 native-chat 的发送约定并对齐）；停止/归档复用现有终端关闭动作。远程会话显示主机徽标；断连显示"无法确认"。
- [ ] 测试：动作流渲染与自动滚到底、等待决定卡显示选项并调用 sendPrompt、发消息、跳终端调用、只读卡无操作与无连接点、SSH 断连文案。→ 实现 → 验证 → Commit `feat(session-canvas): 实况卡与只读卡`

### Task 7: 拖线手势（传话 / 监督）+ 端到端验证
**Files:** Create `session-canvas/ConnectMenu.tsx`、`PassAlongDialog.tsx`、`SuperviseDialog.tsx`（+ tests）；Modify `SessionCanvasPage.tsx`（`onConnect` → 弹菜单；外部卡不可连）。
- 传话：`composePassAlongPrompt({ fromTitle, result: A.lastCompletedAssistantMessage, note })` → `sendPrompt(B)` → `recordPassAlong` → 刷新消息 → 成功 toast。
- 监督：任务必填 → `supervise(A,B,task)` → 失败原因 toast。
- [ ] 组件测试：菜单两项、对话框校验、调用参数。
- [ ] 端到端：构建后 `ORCA_BACKGROUND_LAUNCH=1` 启动（隔离 userData 与 `WEBUDDY_AGENT_HOME`），打开会话画布，CDP 截图：空画布、至少一个实况卡（可用 dev 模式下启动一个 shell 里的真实 agent 不可行时，用注入的状态快照验证渲染），截图存 SDD 工作区。
- [ ] 全量：`pnpm tc`、`pnpm test src/renderer/src/components/session-canvas src/main/ipc/session-canvas* src/shared/agent-status*`、code-quality、localization 校验。→ Commit `feat(session-canvas): 拖线传话与监督`

### Task 8: 弹出独立窗口（第二阶段，同样交付）
**Files:** 仿 `src/main/window/dashboard-popout-window.ts` 与 `src/main/ipc/dashboard-popout.ts` 新增画布弹窗（窗口管理、打开 IPC、快照发布/重放）；页面工具条加"弹出"按钮。复用而非复制：若可把看板弹窗的窗口管理参数化复用，优先参数化。
- [ ] 测试：窗口管理（打开/聚焦/关闭）与快照重放。→ 实现 → 验证 → Commit `feat(session-canvas): 画布弹出窗口`
