# webuddy-server — 数据收集与查看

接收各人机器上传的 agent 会话记录，入库、看板、导出，并在服务端持续做汇总分析。
零依赖：`node:http` + `node:sqlite`，只要求 Node ≥ 22.5。

## 启动

```bash
cd tools/webuddy-server
WEBUDDY_TOKEN=<你自己定一个> node server.mjs
# 浏览器打开 http://127.0.0.1:8787
```

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `WEBUDDY_PORT` | `8787` | 监听端口 |
| `WEBUDDY_TOKEN` | 空 | 空 = **不鉴权**。对外必须设 |
| `WEBUDDY_DATA` | `./data` | SQLite 存放目录 |
| `WEBUDDY_ROLLUP_MS` | `600000` | 汇总重算间隔（10 分钟） |

## 看板前端（`web/`）

React + Vite + Tailwind，构建产物写到 `public/`，由 `server.mjs` 托管（未知的无扩展名路径回退到 `index.html`）。

```bash
cd tools/webuddy-server/web
npm ci
npm run dev      # http://127.0.0.1:5173，/api 代理到 8787（WEBUDDY_API 可改）
npm test         # vitest
npm run build    # 类型检查 + 构建到 ../public
```

Docker 镜像在构建阶段自己跑 `npm run build`，运行时镜像仍然零第三方依赖。

## 采集端怎么接

在每台开发机上：

```bash
node tools/webuddy-agent/index.mjs config set userId=lina
node tools/webuddy-agent/index.mjs config set endpoint=http://<服务器>:8787/api/ingest
node tools/webuddy-agent/index.mjs config set token=<同一个 TOKEN>
node tools/webuddy-agent/index.mjs scan && node tools/webuddy-agent/index.mjs push
```

正文随记录一起发送（脱敏后），不是可选项。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/ingest` | 采集端上传入口，批次 `webuddy.batch.v1` |
| `GET` | `/api/health` | 免鉴权，返回汇总行数 |
| `GET` | `/api/facets` | 人员 / agent 列表，给筛选下拉用 |
| `GET` | `/api/stats?group=person\|agent\|day\|project` | 总量 + 分组排行 |
| `GET` | `/api/sessions` | 会话明细（分页） |
| `GET` | `/api/sessions/:key` | 单条会话，含正文 |
| `GET` | `/api/analysis` | 日 × 人 × agent 汇总表 |
| `GET` | `/api/export.csv` / `.json` | 按当前筛选导出 |

所有读接口支持同一组筛选：`user` / `agent` / `from` / `to` / `q`（`q` 命中路径、分支或**正文**）。

鉴权：`Authorization: Bearer <TOKEN>`，或 `?token=<TOKEN>`（看板用后者，方便直接点导出链接）。

## 服务端分析

- 每次成功入库后，以及每隔 `WEBUDDY_ROLLUP_MS`，重算 `daily_rollups`（日 × 人 × agent 的会话数 / 轮次 / 消息 / token / 分钟）。重算幂等，随时可跑。
- `computeRollups()` 是纯 SQL 聚合，可被任何调用方复用（后续接 LLM 分析、周报生成都从这里取数）。

## 部署（内部）

```bash
# 服务器上（示例：Linux）
mkdir -p /srv/webuddy && cd /srv/webuddy
# 复制本目录过去，建议用 systemd 常驻：
#   ExecStart=/usr/bin/node /srv/webuddy/server.mjs
#   Environment=WEBUDDY_TOKEN=...
#   Environment=WEBUDDY_DATA=/srv/webuddy/data
```

只绑内网/VPN。数据量参考：单台开发机一年约 1–3 GB 正文，SQLite 完全够用；真到几十 GB 再考虑把正文挪到对象存储（表结构已按这个方向留好了 `transcript_body` 这一列）。

## 已知边界

- 没有账号体系，一个共享 token；要按人隔离再做。
- 看板是只读的，不支持删数据（合规上要删得单独做）。
