# webuddy-server — 数据收集与查看

接收各人机器上传的 agent 会话记录，入库、看板、导出，并在服务端持续做汇总分析。
零依赖：`node:http` + `node:sqlite`，只要求 Node ≥ 22.5。

## 启动

```bash
cd tools/webuddy-server
(cd web && npm ci && npm run build)   # 先构建看板到 public/（构建产物，不进 git）
WEBUDDY_ADMIN_USER=admin WEBUDDY_ADMIN_PASSWORD=<首次登录密码> node server.mjs
# 浏览器打开 http://127.0.0.1:8787，用上面的管理员登录，再到「用户与小组」建账号
```

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `WEBUDDY_PORT` | `8787` | 监听端口 |
| `WEBUDDY_HOST` | `127.0.0.1` | 监听地址（容器内为 `0.0.0.0`） |
| `WEBUDDY_DATA` | `./data` | SQLite 存放目录 |
| `WEBUDDY_ADMIN_USER` / `WEBUDDY_ADMIN_PASSWORD` | 空 | 库里还没有任何账号时创建管理员（之后忽略） |
| `WEBUDDY_ROLLUP_MS` | `600000` | 汇总重算间隔（10 分钟） |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | 空 | AI 分析与 Skill 提炼用的模型；不配则这两页显示"未配置模型" |

## 看板前端（`web/`）

React + Vite + Tailwind，构建产物写到 `public/`（已在 `.gitignore`），由 `server.mjs` 托管（未知的无扩展名路径回退到 `index.html`，所以 `/sessions/<key>` 这类深链接可直接刷新）。

页面：总览（KPI、按天/按 agent/按人/按项目、会话明细与导出）、会话详情、AI 分析、Skill 库、用户与小组（仅管理员）。

```bash
cd tools/webuddy-server/web
npm ci
npm run dev      # http://127.0.0.1:5173，/api 代理到 8787（WEBUDDY_API 可改）
npm test         # vitest
npm run build    # 类型检查 + 构建到 ../public
node scripts/seed-dev-data.mjs   # 往本地服务端灌演示数据（用法见文件头）
```

Docker 镜像在构建阶段自己跑 `npm run build`，运行时镜像仍然零第三方依赖；`deploy/deploy.sh` 只上传源码，不带本地的 `public/`。

## 采集端怎么接

在每台开发机上：

```bash
node tools/webuddy-agent/index.mjs config set userId=lina
node tools/webuddy-agent/index.mjs config set endpoint=http://<服务器>:8787/api/ingest
node tools/webuddy-agent/index.mjs config set token=<同一个 TOKEN>
node tools/webuddy-agent/index.mjs scan && node tools/webuddy-agent/index.mjs push
```

正文随记录一起发送（脱敏后），不是可选项。

## 角色与可见范围

每人一个账号，角色三选一；一人只属一个小组，组长也是本组成员。

| 角色 | 能看谁的数据 | 管理 |
|---|---|---|
| `admin` | 所有人 | 账号、小组、令牌 |
| `lead` | 本组全体成员（含自己）；没分组的组长只看自己 | 无 |
| `member` | 只看自己 | 无 |

- 所有读接口都先按角色收窄范围，再叠加筛选：越权的筛选（如 `user=别组的人`）返回空结果，不报错。
- 越权读单条资源（会话、skill 下载等）一律 **404**，不暴露它是否存在。
- `/api/admin/*` 仅管理员，其他角色 403。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/ingest` | 采集端上传入口，批次 `webuddy.batch.v1` |
| `GET` | `/api/health` | 免鉴权，返回汇总行数 |
| `POST` | `/api/auth/login` | 用户名 + 密码换令牌 |
| `GET` | `/api/auth/me` | 当前用户（含 `group_name`）与自己的令牌 |
| `GET` `POST` `DELETE` | `/api/auth/tokens[/:id]` | 管理自己的令牌 |
| `GET` | `/api/groups` | 可见的小组：admin 全部，其他人只有自己所在组 |
| `GET` | `/api/facets` | 可见范围内的人员 / agent / 项目，给筛选下拉用 |
| `GET` | `/api/stats?by=person\|agent\|day\|project\|branch` | 总量 + 分组排行；`limit` ≤ 500 |
| `GET` | `/api/insights` | KPI 汇总；admin/lead 传 `user=__all__` 看可见范围合计 |
| `GET` | `/api/sessions` | 会话明细（分页，`limit` ≤ 200、`offset`） |
| `GET` | `/api/sessions/:key` | 单条会话，含正文；看不到的返回 404 |
| `GET` | `/api/analysis` | 日 × 人 × agent 汇总表 |
| `GET` `POST` | `/api/analysis/llm[/run]` | AI 分析结果 / 立即跑一次（`user=` 选人，admin 可 `__all__`） |
| `GET` `POST` | `/api/skills`、`/api/skills/bundle`、`/api/skills/:id/download`、`/api/skills/extract` | Skill 库 |
| `GET` | `/api/export.csv` / `.json` | 按当前筛选导出 |
| `GET` `POST` `PATCH` | `/api/admin/users[/:id]` | 账号管理（角色、小组 `groupId`、停用），仅 admin |
| `GET` `DELETE` | `/api/admin/users/:id/tokens`、`/api/admin/tokens/:id` | 查看 / 吊销某人的令牌，仅 admin |
| `GET` `POST` `PATCH` `DELETE` | `/api/admin/groups[/:id]` | 小组管理；删组时成员变为未分组、角色不变，仅 admin |

所有读接口支持同一组筛选：`user` / `group`（小组 id，按组员收窄）/ `agent` / `project` / `from` / `to` / `q`（`q` 命中路径、分支或**正文**）。
`/api/stats` 的分组维度用 `by=`；旧版的 `group=person|agent|…` 仍按维度解释以兼容旧客户端，其他 `group=` 值都是小组筛选。

鉴权：`Authorization: Bearer <TOKEN>`，或 `?token=<TOKEN>`（看板只在导出链接里用后者，普通链接没法带请求头）。

## 服务端分析

- 每次成功入库后，以及每隔 `WEBUDDY_ROLLUP_MS`，重算 `daily_rollups`（日 × 人 × agent 的会话数 / 轮次 / 消息 / token / 分钟）。重算幂等，随时可跑。
- `computeRollups()` 是纯 SQL 聚合，可被任何调用方复用（后续接 LLM 分析、周报生成都从这里取数）。

## 部署（内部）

```bash
# 服务器上（示例：Linux）
mkdir -p /srv/webuddy && cd /srv/webuddy
# 复制本目录过去并先构建看板（cd web && npm ci && npm run build），建议用 systemd 常驻：
#   ExecStart=/usr/bin/node /srv/webuddy/server.mjs
#   Environment=WEBUDDY_ADMIN_USER=... WEBUDDY_ADMIN_PASSWORD=...
#   Environment=WEBUDDY_DATA=/srv/webuddy/data
```

只绑内网/VPN。数据量参考：单台开发机一年约 1–3 GB 正文，SQLite 完全够用；真到几十 GB 再考虑把正文挪到对象存储（表结构已按这个方向留好了 `transcript_body` 这一列）。

## 已知边界

- 看板退出登录只清本地令牌，令牌在服务端到期或被吊销前仍然有效。
- 看板是只读的，不支持删数据（合规上要删得单独做）。
