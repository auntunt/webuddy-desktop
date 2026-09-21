# relay 部署交接（手机控制桌面）

目标：手机能操作桌面 Webuddy 会话，**全部数据走我们自己的服务器**，
且**不新增域名、不新增端口**。

---

## 当前状态

```
✅ 1) relay 容器跑起来        webuddy-relay  →  127.0.0.1:8791
✅ 2) nginx 路径分流（443）   /v1/* /health /ready → relay；其余 → webuddy-server
✅ 3) 鉴权对接验收通过        我们的 token → 101；伪造 → 401
⬜ 4) 桌面端指向我们的 relay
⬜ 5) 手机端产物托管 + 配对
⬜ 6) 端到端联调
```

验收命令（**必须 `--http1.1`**，原因见坑 3）：
```bash
curl -s --http1.1 -o /dev/null -w '%{http_code}\n' \
  -H 'Upgrade: websocket' -H 'Connection: Upgrade' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  -H "authorization: Bearer <relay token>" \
  https://webuddyserver.cloudwaveai.cn/v1/host/control
# 期望 101；不带 token 或伪造签名则 401
```

重装：`tools/webuddy-server/deploy/deploy-relay.sh`

---

## 架构

```
手机 ──wss──►  webuddyserver.cloudwaveai.cn (443, nginx)
                    │  location /v1/            → 127.0.0.1:8791 (relay)
                    │  location /api/ + 静态文件 → 127.0.0.1:8790 (webuddy-server)
                    ▼
               relay（单 cell + SQLite）
                    ▲
桌面 Webuddy ──wss──┘  双方都主动连 relay，由它牵线（内网互不可达的问题由此解决）
```

relay 与 webuddy-server 的路径**完全不重叠**：

| 服务 | 路径 |
|---|---|
| webuddy-server | `/` `/app.js` `/admin.js` `/analysis.js` `/skills.js` `/api/*` |
| relay | `/v1/connect/<hostId>` `/v1/host/control` `/v1/host/data/<connId>` `/v1/regions` `/health` `/ready` |

---

## token 契约（已对齐，勿改）

```
算法      ES256（EC P-256；node:crypto 的 ieee-p1363 裸签名 —— DER 会验签失败）
issuer    = ORCA_RELAY_AUTH_ISSUER = https://webuddyserver.cloudwaveai.cn
audience  = 'orca-relay'
claims    sub, prof, relayHostId(/^[A-Za-z0-9_-]{16}$/ 恰好16位),
          purpose:'host-control', exp
```

签发方在 `tools/webuddy-server/lib/relay-tokens.mjs`：
- `GET /api/relay/jwks` 公钥（免鉴权，relay 来取）
- `POST /api/relay/token` 给已登录用户签发
- 私钥持久化在 `WEBUDDY_DATA/relay-signing-key.json`（600）—— **删了所有 token 立刻失效**

线上实测：
```
JWKS   kty=EC crv=P-256 alg=ES256 kid=Z3EF8xgHdoHtllyA
Token  sub=admin  relayHostId=lZEt-6gv66L6_R3U  purpose=host-control
       iss=https://webuddyserver.cloudwaveai.cn   aud=orca-relay
```

---

## 踩过的坑（都是实测出来的）

1. **`PUBLIC_URL` 必须是 origin，不能带路径**
   `https://host/relay` 被拒（`must be an origin`）。校验是 `url.origin !== value`，
   而 origin 含端口 —— 所以 `:8443` 能过校验，但要在安全组开端口（实测 8443 被挡）。
   最终选择：**挂域名根 + nginx 按路径分流**，网络配置一行都不用改。

2. **容器挂载目录权限**
   让 docker 自己建挂载目录会属 `root`，容器内是 `node`(uid 1000)，SQLite 报
   `ERR_SQLITE_ERROR: unable to open database file`。必须先自己 `mkdir` + `chmod 777`。

3. **测 WebSocket 必须 `--http1.1`**
   curl 默认协商 HTTP/2，而 HTTP/2 禁止 `Upgrade`/`Connection` 头，nginx 会丢掉，
   relay 于是收到普通 GET 返回 404。**这不是配置错误**。排查顺序：先直连 relay
   对照（101/401），再经 nginx —— 能立刻区分是配置问题还是测试方法问题。

4. **只需跑 `apps/relay` 一个进程**
   `CELL_ID=combined` 单 cell、不设 `DIRECTOR_URL`、`DATABASE_URL` 留空走 SQLite。
   `relay-ops` / `fence-broker` / `rehome` 都不用起。

5. **构建上下文只要三个目录**
   `apps/relay` + `packages/relay-contract` + `packages/postgres-schema` + 根配置，
   共 436KB，不用传整个 monorepo（505 文件）。

---

## 剩余步骤

**4) 桌面端指向我们的 relay**

`src/main/orca-profiles/profile-cloud-auth-config.ts` 里现在是
`https://relay.cloudwaveai.cn`，改成 `https://webuddyserver.cloudwaveai.cn`；
桌面端还要改成用我们的用户身份去 `POST /api/relay/token` 换 relay token
（现在走的还是上游账号逻辑）。

**5) 手机端托管**

`out/mobile-web`（`pnpm build:mobile-web` 产出）托管到 webuddy-server 或 nginx 静态目录，
配对入口做扫码。

**6) 端到端**

手机连上桌面 → 打开一个会话 → 验证双向输入输出。

---

## 运维备忘

- 服务器上 `sh ~/services/webuddy-server/deploy/deploy.sh` 是**合并**写 `.env`，
  不会冲掉模型配置（这个 bug 已修，别改回去）。
- 服务器 curl 版本老，不认 `--retry-all-errors`。
- `cloud/` 不要打进客户端安装包（已由 `electron-builder.config.cjs` 排除，保持现状）。

## 凭据位置

```
本机 ~/.webuddy-server/                 admin-password / liyibin-password
服务器 ~/services/webuddy-server/.env    LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
GitHub PAT                               用完建议吊销
```
