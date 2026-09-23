# 团队 AI coding 管控看板 — 设计

日期：2026-09-23 · 状态：已确认，待出实施计划

## 背景与目标

Webuddy 的核心目的是**监控团队成员的 AI coding 使用情况**。现状有三个问题：

1. **数据缺失**：桌面端每 30 分钟拉起采集器，但 app 内没有登录入口。采集器只认
   `~/.webuddy-agent/config.json` 里的 token，只能靠命令行 `webuddy-agent login` 写入，
   所以大多数机器根本不上传。`src/main/webuddy/auth.ts` 已写好配置文件的读写，但没有任何调用方。
2. **没有个人视角**：看板只有全局排行和会话列表，看不到"某个人"的使用趋势、习惯、在做什么。
3. **没有团队视角**：看不出活跃率、谁没在用、周期对比、小组差异。

本设计只覆盖**子项目 1：管控看板与数据打通**。桌面端去除 Orca 遗留功能（子项目 2）另立设计。

非目标：会话正文的对话流渲染（保留现有脱敏原文展示，以后只改会话详情页即可）；成员自助注册。

## 分阶段交付

每阶段可单独上线，按顺序进行：

1. **数据打通**：桌面端强制登录，登录即给采集器写凭证；app 内可见采集状态。
2. **权限**：小组 + 组长角色，所有读接口统一走可见范围过滤。
3. **团队视图**：团队页与成员表。
4. **个人详情**：个人页。

新看板（React）从第 2 阶段起落地，第 3、4 阶段在其上加页面。旧的 `public/*.js` 在新看板上线时一次性删除，不做新旧并存。

## 1. 整体架构与部署

```
tools/webuddy-server/
  server.mjs, lib/   后端保持零依赖（node:http + node:sqlite），只新增接口
  web/               新增：React + TypeScript + Vite 看板源码
  public/            改为 Vite 构建产物（不入库），server.mjs 照旧静态托管
```

- 前端：React、TypeScript、Vite、React Router、TanStack Query（缓存与筛选联动）、
  Recharts、Tailwind + shadcn/ui。视觉沿用现有暗色 Vercel 风格。
- 后端运行时依然零依赖；前端依赖只在构建阶段存在。
- Dockerfile 改为两阶段：`node:24` 构建阶段跑 `vite build`，运行阶段只拷产物 + 后端源码。
  `deploy.sh` 继续 tar 源码（加上 `web/`，排除 `node_modules`），服务器上 `docker compose up --build` 完成构建。
- SPA 回退：非 `/api/`、且静态文件不存在的 GET 请求返回 `index.html`，深链接可刷新。
- 本地开发：Vite dev server 代理 `/api` 到 `server.mjs`。

## 2. 权限模型

### 数据

- 新表 `groups(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL)`。
- `users` 加列 `group_id TEXT NULL REFERENCES groups(id)`；`role` 取值扩展为 `admin | lead | member`。
- 一人只属一个小组；组长也是本组成员。没有分组的 `lead` 只能看自己。
- 迁移：`ALTER TABLE` 幂等执行（启动时检查列是否存在），已有用户 `group_id` 为空、角色不变。

### 可见范围

新增 `lib/visibility.mjs`，唯一入口 `resolveVisibleUsers(db, authUser)`：

| 角色 | 返回 |
|---|---|
| admin | `null`（不限制） |
| lead | 本组全部成员的 username 列表 |
| member | `[自己的 username]` |

- `buildWhere` 的 `ownerId`（单值）替换为 `visibleUsers`（数组或 null），生成 `user_id IN (...)`。
  用户传入的 `user` 筛选与之取交集，越界即返回空。
- 现有散落的 `role !== 'admin'` 判断（会话详情 `server.mjs:376`、Skill 下载 `:332`、AI 分析、Skill 列表等）
  全部改为调用同一函数。
- 越权访问单条资源返回 **404**（不暴露存在性）。
- 管理接口（建组、分组、设组长、建/禁用账号）仅 admin。组长不能管理账号。

### 测试

服务端补 `node:test`：`resolveVisibleUsers` 三种角色；每个读接口对"组长读别组 / 成员读他人 / 传入越界 user 参数"的越权用例。

## 3. 页面与指标

### 全局

- 顶栏筛选：时间区间（7/30/90 天、自定义）、小组、agent；筛选状态同步到 URL query，链接可分享。
- 组长的小组筛选锁定为本组；成员登录后直接进入自己的个人页，看不到团队页。

### ① 团队页 `/team`（admin、lead 首页）

- KPI：活跃人数 / 总人数、会话数、token、人均 token；每项附与上一等长周期的变化百分比。
- 趋势：每日活跃人数、每日 token 折线图。
- **成员表**：每人一行 — 姓名、小组、最近上报时间、客户端最近在线、会话数、token、活跃天数、
  主力 agent / 模型、周期变化；任意列可排序。
  - 最近上报距今 ≥ 7 天标红，≥ 3 天标黄；登录过但从未上报的单独标记"无数据"。
  - 包含从未产生会话的账号（成员表以 `users` 为主表左连 `sessions`）。
  - 点击行进入个人页。
- 小组对比（仅 admin）：各组人数、活跃率、人均 token。

### ② 个人详情页 `/people/:username`

- 个人 KPI 与每日趋势（会话数、token）。
- 活跃时段热力图（星期 × 小时，按会话 `started_at` 的本地时间）。
- agent / 模型占比；项目分布（按 `cwd`，附分支）。
- 最近会话列表 → 会话详情。
- 该成员最近一次 AI 分析结论与提炼出的 Skill。

### ③ 会话详情页 `/sessions/:key`

保留现有抽屉内容：元数据分组 + 脱敏正文原文。

### ④ AI 分析 / Skill 库 / 用户与小组

功能照搬到新框架，数据范围按第 2 节收紧。"用户与小组"页新增小组的增删改、成员分组、设为组长。

### 指标口径（页面上以说明提示呈现）

- **活跃**：当天至少 1 条会话（按会话 `local_date`）。
- **时长**：会话首条到末条事件的跨度，挂着不动也计入，仅作参考；主看会话数和 token。
- **token**：以 agent 自报为准；未上报的 agent 显示"—"，不按 0 计入均值。
- **周期对比**：与紧邻的上一等长区间比较。

### 新增 / 调整接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/team/summary` | 团队 KPI + 上一周期值 + 每日趋势 |
| GET | `/api/team/members` | 成员表（含无数据账号、客户端最近在线） |
| GET | `/api/team/groups` | 小组对比（仅 admin） |
| GET | `/api/people/:u/summary` | 个人 KPI、趋势、agent/模型/项目分布 |
| GET | `/api/people/:u/heatmap` | 星期 × 小时计数 |
| CRUD | `/api/admin/groups` | 小组管理（仅 admin） |
| PATCH | `/api/admin/users/:id` | 扩展：`role` 支持 `lead`，新增 `groupId` |

所有读接口接受 `from / to / group / agent`，并统一经过可见范围过滤。

## 4. 桌面端强制登录与采集器打通

在工作区里未提交的"账号面板改为账号密码登录"改动（`/api/desktop/*`，1h access + 30d refresh）基础上继续，
并接上已存在但未被调用的 `src/main/webuddy/auth.ts`。

1. **登录**：桌面登录成功后，服务端在同一响应中额外签发**采集器 token**（有效期 90 天，
   权限仅限 `/api/ingest`，存 `api_tokens`，`label = 'collector'`）。主进程通过 `auth.ts` 写入
   `config.json`（0600），同时写 `userId` 与 `endpoint`。采集器本身不改。
2. **强制**：主进程判定未登录时，渲染层根部只渲染全屏登录页，不挂载工作区，无跳过入口。
   登录页字段：用户名、密码、服务器地址（默认线上，可改为内网/测试）。
3. **退出 / 换人**：退出时调用服务端吊销采集器 token，清空 `config.json` 中的凭证，回到登录页。
   换人登录直接覆盖；服务端以 token 所属账号覆盖记录的 `actor.userId`（已有逻辑），不会串身份。
4. **过期**：refresh token 失效 → 回到登录页。采集器上传收到 401 → 在 `config.json` 记录
   `authError`，app 检测到后要求重新登录。
5. **状态可见**：账号面板显示当前身份、小组、采集状态（上次上传、待上传条数、最近错误），
   数据来自采集器 `status --json`。
6. **后台可见**：成员表"客户端最近在线"取该用户所有有效 token 的最大 `last_used_at`，
   区分"装了 app 但没用 agent"和"根本没开 app"。

### 测试

- 主进程单元测试：登录写配置、退出清理与吊销、401 触发重登、换人覆盖。
- 服务端：采集器 token 只能调 `/api/ingest`，其他接口 401。
- UI：`ORCA_BACKGROUND_LAUNCH=1` 后台启动 + CDP 截图验证强制登录页，不抢焦点。

## 风险与待定

- 工作区未提交的 48 个文件是第 1 阶段的基础，开工前先单独提交，避免与新改动混杂。
- 现有 SQLite 数据需要迁移（加列、加表），迁移脚本需幂等，上线前在服务器数据副本上演练。
- 采集器 token 90 天有效期内不自动续期：app 每次启动时若剩余 < 30 天则静默换发。
