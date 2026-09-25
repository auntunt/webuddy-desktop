# 会话画布（多 agent 实况指挥台）— 设计

日期：2026-09-26 · 状态：方向已由产品确认（会话为主角、实况卡片墙、传话/监督双手势、含外部只读会话、全局一张画布），细节由实现方按本文裁定

## 目标

Webuddy 的门面功能：在**一张无限画布**上看到所有 AI agent 会话**同时在干活**，并能直接指挥它们。
主角是**会话**（不是 git 分支、不是项目进度）。

成功标准：
- 打开画布，本机所有 Webuddy 终端里的 agent 会话以"迷你终端"卡片出现，实时滚动它们正在做的动作；外部会话（其他终端/编辑器里跑的）以灰色只读卡出现。
- 会话之间的关系以连线呈现：**启动了**、**发过消息**、**子代理**、**同一文件**。
- 能在卡片上直接：允许/拒绝权限请求、发消息、跳到终端；从一张卡拖线到另一张卡，松手选择"**传话**"或"**监督**"。

非目标（本期不做）：项目进度 / git graph 视图；星图（力导向）模式；外部会话的任何控制；团队（服务端）视角的画布；自动接力流水线。

## 1. 架构与数据来源

- **位置**：新的顶级页面"会话画布"，侧边栏入口；懒加载。可弹出为独立窗口，复用看板弹窗机制（`src/main/window/dashboard-popout-window.ts`、`src/main/ipc/dashboard-popout.ts` 的 snapshot 发布/重放模式）。弹窗做成第二阶段任务，主窗口页面优先。
- **画布库**：`@xyflow/react`（React Flow，MIT）。卡片是普通 React 组件。开启只渲染可见元素以控制性能。
- **数据来源（全部复用，按需小幅扩展）**：

| 画布需要 | 来源 | 是否新增 |
|---|---|---|
| 卡片状态、当前动作、最新回复、等待中的请求 | agent 状态存储 `AgentStatusEntry`（`src/shared/agent-status-types.ts`），渲染层经 `agentStatus:set/clear/getSnapshot` 订阅（`src/preload/api/agent-status-bridge.ts`） | 无 |
| 卡片的**实时滚动动作流** | 存储目前只有"当前工具" + 20 条状态历史（`stateHistory`，`AGENT_STATE_HISTORY_MAX`） | **新增** `actionHistory: {toolName, toolInput, at}[]`，上限 30，在 `agent-status-store-mutation.ts` 写 toolName/toolInput 的同一路径追加，随 `agentStatus:set` 下发 |
| 子代理 | 条目上的 `subagents: AgentSubagentSnapshot[]` | 无 |
| "启动了"连线 | `DashboardCard.parentPaneKey`、`AgentStatusEntry.orchestration`（coordinatorHandle / parentPaneKey / runId） | 无 |
| "发过消息"连线 | 编排 mailbox 的已投递消息（只读投影）+ 画布自己的传话记录 | 新增只读 IPC + 本地传话日志 |
| "同一文件"连线 | 渲染层 `gitApi.status({worktreePath, connectionId})`（`src/preload/api/git-bridge.ts`），对同一仓库内不同会话的已改文件求交 | 纯渲染层计算 |
| 外部只读会话 | AI Vault 扫描（`listAiVaultSessions`，与采集器同源）：agent、标题、cwd、更新时间、`previewMessages` | 新增一个只读 IPC（主进程调用已有列表），约 60s 刷新 |

- **图投影**：一个纯函数 `buildSessionGraph(inputs) → { nodes, edges, groups }`，输入为状态快照、外部会话列表、每个 worktree 的已改文件、消息记录、已保存的卡片位置；输出 React Flow 所需结构。与 UI 解耦、可单测。
- **外部会话去重**：若某个 AI Vault 会话对应一个正在 Webuddy 终端里运行的会话（同 agent + 同 provider 会话 id / 同 transcript 路径），只显示实况卡，不重复出只读卡。

## 2. 卡片与画布交互

**实况卡（Webuddy 会话）**
- 头部：agent 图标与名称、会话标题（终端标题或首条 prompt 截断）、状态灯（工作中脉动 / 等你决定琥珀 / 完成 / 空闲灰）。
- 主体：动作流（最近动作，新的在底部，自动滚到底，每行"工具名 + 简短参数"），下方一行最新回复摘要。
- 底部：项目名 · 分支或 worktree · 本状态持续时长；远程（SSH）会话显示主机徽标。
- 子代理：卡片下缘的胶囊列表（名称 + 状态）。
- 等你决定：琥珀边框，卡内显示请求摘要与选项按钮（复用桌面端已有的 `parseApprovalFromStatus` / `NativeChatApprovalCard` 能力）。
- 快捷操作：发消息输入框（展开式）、跳到终端（复用 `reveal-dashboard-agent.ts`）、停止/归档（复用现有终端关闭动作）。

**只读卡（外部会话）**：灰色，角标"外部 · 只读"，显示最近 3 条预览消息、agent、项目、更新时间；无连接点、无操作按钮。

**画布**
- 平移、缩放、适应视图、小地图。
- 按项目（仓库）分组：每个项目一块带标题的浅色背景区域（React Flow 分组节点）；新会话自动放到父会话旁边，否则放进所属项目区域的下一个空位。
- 用户拖动卡片后记住位置（本地持久化，键为 paneKey 或外部会话 id）；"重新排列"按钮恢复自动布局。
- 顶部工具条：搜索、按项目 / agent / 状态筛选、显示外部会话开关、隐藏空闲超过 N 小时的会话（默认 12 小时）。
- 连线样式：启动了＝实线箭头；发过消息＝带流动光点的曲线（最近 10 分钟内的消息才动画）；子代理＝卡片内胶囊（不画线）；同一文件＝红色虚线，悬停显示文件列表。

## 3. 三类动作

1. **允许 / 拒绝**：解析 `interactivePrompt` 或终端文本得到选项，每个选项带要发送的按键，调用下述发送通道写入该会话终端。仅在状态为 waiting / blocked 时出现。
2. **发消息**：卡片输入框 → 主进程 `runtime.sendTerminalAgentPrompt(handle, prompt)`（即 RPC `terminal.send` 的实现）。新增 IPC `sessionCanvas:sendPrompt({ paneKey, text })`，主进程按 paneKey 解析终端句柄。
3. **拖线 A → B，松手弹出小菜单**（外部只读卡不可作为端点）：
   - **传话**：弹出小输入框（可附言），组合为"来自〈A 标题〉的结果：…（A 的 `lastCompletedAssistantMessage`，截断到 4000 字）\n\n附言：…"发送给 B；在本地传话日志记一笔，用于"发过消息"连线。
   - **监督**：输入任务说明（必填），调用编排已有的 worker-start 流程，参数 `terminal = B 的终端句柄`、`from = A 的终端句柄`，在不新开终端的情况下把 B 绑定为 A 的工人并投递前言（`startLocalWorker` + `assertExplicitWorkerTerminalUsable` 已支持）。新增 IPC `sessionCanvas:supervise({ coordinatorPaneKey, workerPaneKey, task })`。校验失败（例如 B 不在同一 worktree、B 不是 agent 终端）把服务端的原因原样提示给用户。

## 4. 错误、SSH、性能与测试

- **错误**：所有新 IPC 返回 `{ ok: true } | { ok: false, reason }`，失败以 toast 提示，不抛到 UI。
- **SSH**：状态存储里的远程会话照常显示；连接中断时卡片显示"无法确认"（`unverifiable`），绝不显示为"已结束"或直接消失（遵守 `docs/reference/ssh-execution-boundary.md`）。
- **性能**：图投影做记忆化；git 状态只对画布上出现的 worktree 查询，页面可见时每 15 秒一次，页面隐藏时停；外部会话每 60 秒刷新；React Flow 只渲染可见元素；动作流每卡最多 30 行。
- **测试**：
  - 单测：`actionHistory` 环形缓冲（追加、上限、随状态下发）；`buildSessionGraph`（节点、分组、四类连线、外部去重、位置合并）；传话 prompt 组装（截断、附言）；卡片位置持久化；主进程两个新 IPC（发送、监督，含失败原因透传）。
  - 组件测试：实况卡、只读卡、等待决定卡、拖线菜单。
  - 端到端：按仓库规则 `ORCA_BACKGROUND_LAUNCH=1` 后台启动，CDP 截图验证画布、卡片和一次传话。
- **文件规模**：遵守 ≤300 行；画布代码放 `src/renderer/src/components/session-canvas/`，纯逻辑放 `src/shared/session-canvas-*.ts` 或同目录的 `*-model.ts`。
