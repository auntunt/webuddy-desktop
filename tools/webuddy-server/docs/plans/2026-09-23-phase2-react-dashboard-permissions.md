# 阶段 2：三级权限 + React 新看板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 服务端支持"管理员 / 组长 / 成员"三级可见范围与小组管理；管理后台换成 React 单页应用，功能对齐旧看板（总览、会话详情、AI 分析、Skill 库、用户与小组），并能用现有 `deploy.sh` 一键部署。

**Architecture:** 后端仍零依赖。先把 `server.mjs` 的请求处理抽到 `lib/app.mjs` 以便起测试服务器；新增 `lib/visibility.mjs` 作为唯一的可见范围入口，所有读接口经它过滤。前端在 `web/`（Vite + React + TS），构建产物输出到 `public/`（不入库），`server.mjs` 托管并做 SPA 回退；Docker 两阶段构建。

**Tech Stack:** 服务端 Node 24 + node:sqlite + node:test；前端 React 19、TypeScript、Vite、React Router、TanStack Query、Recharts、Tailwind CSS v4（`@tailwindcss/vite`）、lucide-react、Radix（按需），测试 Vitest + Testing Library；前端包管理用 **npm**（`web/package-lock.json`，独立于仓库根的 pnpm）。

**Spec:** `tools/webuddy-server/docs/2026-09-23-team-monitoring-dashboard-design.md` 第 1、2、3 节（第 3 节中团队页与个人页属于阶段 3、4，本阶段不做）。

## Global Constraints

- 服务端运行时零第三方依赖；测试 `cd tools/webuddy-server && node --test`（Node 24 用裸 `node --test` 自动发现）。
- 角色：`admin | lead | member`。一人只属一个小组；组长也是本组成员；没有分组的 `lead` 只能看自己。
- 可见范围唯一入口 `resolveVisibleUsers(db, authUser)`：admin → `null`（不限）；lead → 本组所有成员 username（含自己，无组则 `[自己]`）；member → `[自己]`。
- 越权读取单条资源（会话、skill 下载等）一律 **404**；越权的列表筛选返回空集合，不报错。
- 管理接口（`/api/admin/*`）仅 admin；组长不能管理账号或小组。
- 数据库迁移幂等：`CREATE TABLE IF NOT EXISTS`；加列前用 `PRAGMA table_info` 判断。已有用户 `group_id` 为空、角色不变。
- 前端视觉：沿用旧看板的暗色 Vercel 风格（纯黑底、1px 细描边 `#262626`、单一强调色 `#0070f3`、无渐变、tabular 数字）。颜色集中定义为 CSS 变量（`web/src/index.css` 的 `@theme`），组件内不写散落的色值。
- 前端文案中文。
- 旧看板的 `public/*.js`、`public/index.html` 在 Task 8 删除；`public/` 改为构建产物并加入 `tools/webuddy-server/.gitignore`。
- 仓库规则（AGENTS.md）：注释只写简短的 Why；文件 ≤300 行（不加 max-lines 豁免）；不用 `helpers/utils` 之类的文件名；类型断言避免（必要时 `SAFETY:` 注释）。`web/` 的 TS/TSX 需要通过仓库根的 `npx oxlint <files>`（lint-staged 会跑）。若根 oxlint 的某条规则明显只适用于 Electron 渲染层（如 design-system 规则），在报告中说明，不要全局关闭。
- 不在仓库根跑 `pnpm format`；只格式化自己改的文件。不用 `--no-verify`。

---

### Task 1: 服务端 — 抽出请求处理器 + 测试服务器

**Files:**
- Create: `tools/webuddy-server/lib/app.mjs`（`createRequestHandler(deps)`）
- Modify: `tools/webuddy-server/server.mjs`（只保留：读环境变量、openDb、bootstrap admin、relay 密钥、定时任务、`createServer(createRequestHandler(...)).listen`）
- Create: `tools/webuddy-server/test/harness.mjs`
- Create: `tools/webuddy-server/test/app-smoke.test.mjs`

**Interfaces:**
- Produces: `createRequestHandler({ db, relay: { privateKey, kid, issuer, publicJwk }, publicDir }) → (req, res) => Promise<void>`；行为与当前 `server.mjs` 中 `createServer` 回调完全一致（纯搬移，本任务不改任何路由逻辑）。`serveStatic`、`authenticate`、`filtersOf`、`validate`、`readBody`、`json` 一并搬入（或拆到 `lib/http-io.mjs` 以控制行数 ≤300）。
- Produces（测试用）：`startTestServer() → Promise<{ baseUrl, db, close(), createUser({username, password?, role?, groupId?}) → user, login(username, password?) → token, api(token, path, init?) → Response }>`。用临时目录建 db，`listen(0, '127.0.0.1')`，relay 用 `loadOrCreateSigningKey(tmpDir)`。默认密码 `password1`。

- [ ] **Step 1**：写 `test/app-smoke.test.mjs`：`/api/health` 200；未带 token 访问 `/api/sessions` 401；`createUser` + `login` 后 `/api/auth/me` 返回该用户；POST `/api/ingest` 一条最小合法记录（字段见 `server.mjs` 的 `REQUIRED`/`REQUIRED_PATHS`，record 形状参考 `tools/webuddy-agent/lib/schema.mjs`）后 `/api/sessions` 能查到。在 `test/harness.mjs` 里提供 `ingestSession(token, overrides)` 构造记录（userId 会被服务端改写为 token 所属用户）。
- [ ] **Step 2**：运行 `node --test` 确认失败（harness/app.mjs 不存在）。
- [ ] **Step 3**：搬移代码。`server.mjs` 的定时器、`computeRollups` 初始调用、日志保持不变。
- [ ] **Step 4**：`node --test` 全部通过（含阶段 1 的 `collector-token.test.mjs`）。本地 `WEBUDDY_PORT=8799 WEBUDDY_DATA=$(mktemp -d) WEBUDDY_ADMIN_USER=admin WEBUDDY_ADMIN_PASSWORD=adminpass1 node server.mjs` 能启动，旧看板 `http://127.0.0.1:8799/` 能打开（curl 200）。
- [ ] **Step 5**：Commit `refactor(webuddy-server): 请求处理抽到 lib/app.mjs，加测试服务器`

---

### Task 2: 服务端 — 小组数据 + 可见范围，接到所有读接口

**Files:**
- Modify: `tools/webuddy-server/lib/db.mjs`（`groups` 表；`users.group_id` 迁移）
- Create: `tools/webuddy-server/lib/visibility.mjs`
- Modify: `tools/webuddy-server/lib/queries.mjs`（`buildWhere` 用 `visibleUsers` 取代 `ownerId`；`rollups` 同样过滤）
- Modify: `tools/webuddy-server/lib/app.mjs`（`filtersOf` 与所有读路由）
- Modify: `tools/webuddy-server/lib/auth.mjs`（`PUBLIC_USER_COLUMNS` 加 `group_id`）
- Create: `tools/webuddy-server/test/visibility.test.mjs`、`tools/webuddy-server/test/read-scope.test.mjs`

**Interfaces:**
- Schema：`CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL)`；`users.group_id TEXT NULL REFERENCES groups(id)`。
- Produces（`visibility.mjs`）：
  - `resolveVisibleUsers(db, authUser) → string[] | null`
  - `canSeeUser(visibleUsers, username) → boolean`（`null` 视为全部可见）
  - `groupMembers(db, groupId) → string[]`（username 列表，给 `group` 筛选用）
- Produces（`buildWhere`）：参数 `{ visibleUsers, user, group, agent, project, from, to, q }`。`visibleUsers` 为数组时生成 `user_id IN (...)`（空数组生成 `1 = 0`）；`group` 是 username 数组（由调用方用 `groupMembers` 解析），同样 `IN`。`ownerId` 删除，全仓 grep 替换。
- `filtersOf(url, auth, db)`：`visibleUsers = resolveVisibleUsers(db, auth.user)`；`group` 查询参数 → `groupMembers`。

需要逐一改的路由（行为规则）：
| 路由 | 规则 |
|---|---|
| `/api/facets`、`/api/stats`、`/api/sessions`、`/api/analysis`、`/api/export.*` | 走 `filtersOf` |
| `/api/sessions/:key` | 不可见 → 404 |
| `/api/insights` | `user` 参数：`__all__` 或空 → 可见范围全部；否则须 `canSeeUser`，不可见 → 空结果（走 filtersOf 自然为空） |
| `/api/analysis/llm` GET | `user=__all__` 仅 admin；`user=X` 须可见，否则 404；缺省为自己 |
| `/api/analysis/llm/run` POST | 同上规则决定 owner（admin 可 `__all__` → `null`）；member 只能自己 |
| `/api/skills`、`/api/skills/bundle` | `user=X` 须可见，否则 404；缺省自己 |
| `/api/skills/:id/download` | skill.user_id 不可见 → 404 |
| `/api/skills/extract` POST | `user=X` 须可见（缺省自己） |

- [ ] **Step 1**：`test/visibility.test.mjs`：admin → null；lead（组 A，成员 a1、a2、lead 自己）→ 三个 username；lead 无组 → `[自己]`；member → `[自己]`；member 有组也只看自己；`canSeeUser` 真值表。
- [ ] **Step 2**：`test/read-scope.test.mjs`（用 harness，数据：组 A = lead1、a1；组 B = b1；每人 ingest 1 条会话；另有 admin）：
  - lead1 `/api/sessions` 只含 lead1、a1；`?user=b1` → 空；`/api/sessions/<b1 的 key>` → 404；`/api/facets` people 不含 b1。
  - a1 `/api/sessions` 只含自己；`?user=lead1` → 空。
  - admin 全部 3 条；`?group=<A id>` → 2 条。
  - `/api/skills?user=b1` 以 lead1 → 404；以 admin → 200。
  - `/api/analysis/llm?user=__all__` 以 lead1 → 404（或 403，统一用 404）。
  - `/api/export.json` 以 lead1 → 2 条。
- [ ] **Step 3**：`node --test` 确认失败。
- [ ] **Step 4**：实现。迁移写在 `openDb` 里 `db.exec(SCHEMA)` 之后。
- [ ] **Step 5**：`node --test` 全绿；在一份线上库副本的本地拷贝上验证迁移不可行时，至少用"先建旧表结构再 openDb"的测试覆盖迁移路径（在 `visibility.test.mjs` 里加一条：旧 schema（无 group_id 列）的库文件经 `openDb` 后有该列，重复 `openDb` 不报错）。
- [ ] **Step 6**：Commit `feat(webuddy-server): 小组与三级可见范围，所有读接口统一过滤`

---

### Task 3: 服务端 — 小组管理与角色接口

**Files:**
- Modify: `tools/webuddy-server/lib/auth.mjs`（`updateUser` 支持 `role: 'lead'`、`groupId`；`createUser` 支持 `groupId`）
- Create: `tools/webuddy-server/lib/group-routes.mjs`（`/api/admin/groups*` 与 `/api/groups`）
- Modify: `tools/webuddy-server/lib/auth-routes.mjs`（用户列表带 `group_id, group_name`；POST 用户接受 `role`（三种）与 `groupId`；PATCH 最后一个管理员保护把 `lead` 也算作降级；`/api/auth/me` 返回 `group_id, group_name`）
- Modify: `tools/webuddy-server/lib/app.mjs`（挂载 group-routes）
- Create: `tools/webuddy-server/test/admin-groups.test.mjs`

**Interfaces:**
- `GET /api/admin/groups` → `{ groups: [{ id, name, created_at, member_count, lead_usernames: string[] }] }`
- `POST /api/admin/groups` `{ name }` → 201 `{ group }`；空名 400；重名 409
- `PATCH /api/admin/groups/:id` `{ name }` → `{ group }`；不存在 404；重名 409
- `DELETE /api/admin/groups/:id` → `{ ok: true }`；组内成员 `group_id` 置空，其中 `lead` 角色保留（变成无组组长，只能看自己）
- `PATCH /api/admin/users/:id` 追加 `groupId: string | null`（不存在的组 → 400），`role` 接受 `admin | lead | member`
- `GET /api/groups`（任何登录用户）→ admin：全部小组；lead/member：自己所在组（无组则空数组）。形状 `{ groups: [{ id, name }] }`，供前端筛选下拉用。
- `GET /api/auth/me` → `user` 增加 `group_id`、`group_name`。

- [ ] **Step 1**：测试：非 admin 调 `/api/admin/groups` → 403；建组、改名、重名 409；把用户设为 lead 并分到组后，该 lead 的 `/api/sessions` 范围随之变化；删组后该 lead 只看自己；`/api/groups` 三种角色的返回；`/api/auth/me` 带 group_name；最后一个 admin 改为 lead → 400。
- [ ] **Step 2**：确认失败 → **Step 3** 实现 → **Step 4** `node --test` 全绿。
- [ ] **Step 5**：Commit `feat(webuddy-server): 小组管理接口与组长角色`

---

### Task 4: 前端工程骨架 + 登录 + 布局 + 服务端托管与部署

**Files:**
- Create: `tools/webuddy-server/web/`：`package.json`、`package-lock.json`、`vite.config.ts`、`tsconfig.json`、`index.html`、`src/main.tsx`、`src/index.css`、`src/app-routes.tsx`、`src/api/client.ts`、`src/api/types.ts`、`src/auth/session.tsx`（token 存取 + `useMe`）、`src/pages/LoginPage.tsx`、`src/layout/AppShell.tsx`（顶栏：logo、导航、当前用户、退出）、`src/filters/use-dashboard-filters.ts`（与 URL query 双向同步）、`src/components/ui/*`（Button、Input、Select、Card、Badge、Table、Dialog、EmptyState —— 手写、极简、基于 Tailwind）、`src/**/*.test.ts(x)`
- Modify: `tools/webuddy-server/lib/app.mjs`（`serveStatic`：支持 `assets/` 子路径与常见类型 js/css/svg/png/ico/woff2/json/map；hashed 资源 `cache-control: public, max-age=31536000, immutable`，`index.html` `no-cache`；**SPA 回退**：GET、非 `/api/`、无扩展名或文件不存在 → `index.html`；路径穿越防护：规范化后必须位于 publicDir 内）
- Modify: `tools/webuddy-server/Dockerfile`（两阶段）、`tools/webuddy-server/deploy/deploy.sh`（tar 加 `web`，排除 `web/node_modules`、`web/dist`；去掉 `public`）、`tools/webuddy-server/.gitignore`（新建或修改：`web/node_modules/`；`public/` 的忽略在 Task 8 旧文件删除时再加）
- Modify: `tools/webuddy-server/README.md`（开发与构建说明，简短）

**Interfaces:**
- `vite.config.ts`：`build.outDir = '../public'`、`emptyOutDir = true`；dev server `proxy: { '/api': 'http://127.0.0.1:8787' }`（端口可用环境变量 `WEBUDDY_API` 覆盖）。
- **注意**：本任务期间 `public/` 仍保留旧看板。为不覆盖旧文件，本任务的构建验证使用 `npx vite build --outDir /tmp/<临时目录>`；`outDir: '../public'` 在 Task 8 切换时才第一次真正写入。Dockerfile 在本任务就改为用 web 构建产物（因为 Task 8 之前不部署，这一顺序是安全的）。
- `api/client.ts`：`apiFetch<T>(path, { method?, body?, query? }) → Promise<T>`；自动带 `Authorization: Bearer <token>`；401 → 清 token 并跳 `/login`；非 2xx 抛 `ApiError(status, message)`（message 取服务端 `error` 字段）。
- `auth/session.tsx`：`AuthProvider`、`useAuth() → { token, me, login(username, password), logout() }`；`me` 来自 `/api/auth/me`（`{ id, username, display_name, role: 'admin'|'lead'|'member', group_id, group_name }`）。登录调用 `/api/auth/login`，`label: 'dashboard'`。token 存 `localStorage['webuddy.token']`（try/catch）。
- `use-dashboard-filters.ts`：`{ filters: { from?, to?, range?: '7'|'30'|'90'|'all', group?, agent?, user?, project?, q? }, setFilters(patch) }`，值即 URL query；`range` 与 `from/to` 互斥（选区间时清空自定义日期，反之亦然）；导出 `toApiQuery(filters)`（把 range 换算为 `from`，本地日期 `YYYY-MM-DD`）。
- 路由：`/login`、`/`（总览）、`/sessions/:key`、`/analysis`、`/skills`、`/admin/users`（仅 admin，其他角色重定向 `/`）。本任务只放占位页。导航按角色显示（"用户与小组"仅 admin）。
- Dockerfile：
```dockerfile
FROM node:24-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build   # 产物写入 /src/public

FROM node:24-alpine
WORKDIR /app
COPY server.mjs package.json ./
COPY lib ./lib
COPY --from=web /src/public ./public
# 其余（ENV/HEALTHCHECK/CMD）保持原样
```

- [ ] **Step 1**：`npm create vite` 不可交互时手工建文件；装依赖（`npm install`，生成 lock）。
- [ ] **Step 2**：先写测试：`use-dashboard-filters`（URL 同步、range/自定义日期互斥、`toApiQuery` 的日期换算，固定 `Date` 用 `vi.useFakeTimers`）；`api/client`（401 清 token；错误 message 透传）。服务端补 `test/static.test.mjs`：`/assets/x.js` 返回 js 类型与长缓存；`/people/lina`（无扩展名）返回 index.html；`/../server.mjs` 类路径 404；`/api/unknown` 仍是 JSON 404。测试用临时 publicDir（harness 支持传入 `publicDir`）。
- [ ] **Step 3**：实现；`npm run build -- --outDir <tmp>`、`npm test`、`npx tsc --noEmit -p web`、`cd tools/webuddy-server && node --test` 全绿；`npx oxlint web/src` 通过。
- [ ] **Step 4**：手动：`node server.mjs`（8787）+ `npm run dev`，Playwright/浏览器登录能进入占位页，退出回登录页。
- [ ] **Step 5**：`docker build -t webuddy-server:test tools/webuddy-server`（若本机有 docker；没有则在报告中写明未验证）。
- [ ] **Step 6**：Commit `feat(webuddy-server): React 看板骨架、登录与布局；静态托管支持 SPA`

---

### Task 5: 总览页 + 会话详情页

**Files:**
- Create: `web/src/pages/OverviewPage.tsx`、`web/src/pages/SessionDetailPage.tsx`、`web/src/overview/*`（KpiRow、DailyChart、RankingCard、SessionsTable、FilterBar 等，按职责拆文件）、`web/src/format/*.ts`（数字、时长、日期格式化）及测试

**功能对齐旧看板（`public/app.js`）**：
- 筛选栏：人员（`/api/facets` people）、agent、项目、小组（`/api/groups`，仅当返回多于 0 个时显示；lead 只有自己组时显示为固定标签）、区间（7/30/90/全部 + 自定义起止日期）、关键词（路径/分支/正文）；"导出 CSV / JSON"链接（`/api/export.csv?token=...&<filters>`）。
- KPI（`/api/insights`，带同一套筛选；admin/lead 未选人时传 `user=__all__`）：会话数、活跃天数、累计时长（注明单会话封顶 12 小时，被封顶条数用 tooltip 说明）、token（为 0 或空显示"—"）、项目数。
- 图表（`/api/stats?group=day|agent|person|project&limit=500`）：按天折线/柱（Recharts，缺失日期补零）、按 agent / 按人 / 按项目排行条（Top 10，可展开全部，限高滚动）。成员角色隐藏"按人"。点击排行项 → 设置对应筛选。
- 会话列表（`/api/sessions` 分页 50，带 total）：日期、人、agent / 模型、项目（cwd 尾段 + tooltip 全路径）、分支、轮次、token、时长、正文完整/截断。点击行 → `/sessions/:key`。
- 会话详情页：元数据分组（身份、时间、规模、位置、合规——与旧抽屉一致），正文 `<pre>` 原样显示（已脱敏）；正文超过 2MB 时先显示前 2MB 并提供"显示全部"。返回按钮保留列表筛选（用 `navigate(-1)` 或带 query 回跳）。
- 空态、加载态、错误态都有；数字 tabular。

- [ ] **Step 1**：测试：format 函数（时长、token "—"、日期）；`SessionsTable` 渲染与点击导航；Overview 在 member 角色下不渲染"按人"卡片（mock `apiFetch`）。
- [ ] **Step 2**：实现并通过 `npm test`、`tsc`、oxlint。
- [ ] **Step 3**：本地起服务端（用 harness 同款最小记录 ingest 20 条跨 3 人、2 agent、多天的会话，脚本放 `web/scripts/seed-dev-data.mjs`，调用 `/api/ingest`），浏览器（Playwright 截图）核对页面；截图存 `.superpowers/` 工作区（由控制方指定路径）。
- [ ] **Step 4**：Commit `feat(webuddy-server): 看板总览与会话详情`

---

### Task 6: AI 分析页 + Skill 库页

**Files:**
- Create: `web/src/pages/AnalysisPage.tsx`、`web/src/pages/SkillsPage.tsx`、`web/src/markdown/MarkdownView.tsx`（分析结果是 Markdown：用 `react-markdown` + `remark-gfm` 渲染，禁用原始 HTML）及测试

**功能（对齐 `public/analysis.js`、`public/skills.js`）**：
- 人员选择器：admin 有"全组"（`__all__`）+ 所有可见人员；lead 为本组成员（不含"全组"）；member 无选择器（只看自己）。选择写入 URL `?user=`。
- 分析页：显示模型、生成时间、覆盖会话数、token；正文 Markdown；"立即分析"（POST `/api/analysis/llm/run?user=`，按返回的 `skipped` 显示"没有新数据，本次跳过"或"未配置模型"）；"刷新"。
- Skill 页：列表（标题、摘要、标签、证据会话数、生成时间），展开看正文 Markdown；单条下载（`/api/skills/:id/download?token=`）、整包下载（`/api/skills/bundle?user=&token=`）；"立即提炼"（POST `/api/skills/extract?user=`）。
- 服务端配合（若 Task 2 未覆盖）：`/api/analysis/llm/run` 与 `/api/skills/extract` 接受 `?user=`，规则见 Task 2 表格。

- [ ] 测试 → 实现 → `npm test`/`tsc`/oxlint → 截图核对 → Commit `feat(webuddy-server): 看板 AI 分析与 Skill 库`

---

### Task 7: 用户与小组管理页（仅 admin）

**Files:**
- Create: `web/src/pages/AdminUsersPage.tsx`、`web/src/admin/*`（UsersTable、UserDialog、GroupsPanel、GroupDialog、TokensDialog）及测试

**功能（对齐 `public/admin.js` 并扩展）**：
- 用户表：用户名、姓名、角色（管理员/组长/成员）、小组、会话数、最近活跃、有效 token 数、状态（启用/禁用）；按用户名/姓名筛选。
- 新建用户：用户名、姓名、初始密码（≥8 位）、角色、小组。
- 编辑用户：姓名、角色、小组、重置密码、禁用/启用。服务端返回的错误（如"至少要保留一个启用中的管理员"）原样提示。
- 查看/吊销某用户的 token（`/api/admin/users/:id/tokens`、`DELETE /api/admin/tokens/:id`），label 以 `collector:` 开头的显示为"采集器（设备 xxxx 前 8 位）"。
- 小组面板：列出小组（成员数、组长），新建、改名、删除（二次确认：说明组员会变为无组）。
- 非 admin 访问 `/admin/users` → 重定向 `/`。

- [ ] 测试（表单校验、角色显示映射、collector label 显示、非 admin 重定向）→ 实现 → `npm test`/`tsc`/oxlint → 截图核对 → Commit `feat(webuddy-server): 看板用户与小组管理`

---

### Task 8: 切换上线准备 + 端到端验证

**Files:**
- Delete: `tools/webuddy-server/public/app.js`、`admin.js`、`analysis.js`、`skills.js`、`index.html`
- Modify: `tools/webuddy-server/.gitignore`（加 `public/`）
- Modify: `tools/webuddy-server/README.md`（看板说明更新；接口表补上小组与可见范围规则）

- [ ] **Step 1**：删除旧文件，`cd web && npm run build`（这次真正写入 `../public`），确认 `git status` 不出现 `public/` 下的文件。
- [ ] **Step 2**：起本地服务端（临时数据目录，端口 8799），种子数据：admin、组 A（lead1、a1）、组 B（b1），每人若干会话（`web/scripts/seed-dev-data.mjs`）。
- [ ] **Step 3**：Playwright（无头）逐角色登录截图：admin 总览 + 用户与小组页；lead1 总览（只含组 A 数据、筛选下拉无 b1）；a1 总览（无"按人"）；打开一条会话详情；刷新深链接 `/sessions/<key>` 仍可打开；AI 分析页（未配置模型时显示提示）。
- [ ] **Step 4**：`docker build` 成功（若本机有 docker），容器内 `curl /api/health` 200、`curl /` 返回新 index.html。
- [ ] **Step 5**：`node --test`、`npm test`、`tsc`、oxlint 全绿。
- [ ] **Step 6**：Commit `feat(webuddy-server): 新看板替换旧版`
