# relay 部署交接（手机控制桌面）

目标：手机能操作桌面 Webuddy 会话，**全部数据走我们自己的服务器**
（`https://webuddyserver.cloudwaveai.cn/relay`），不新增域名。

---

## 一、已完成并线上验证

**1. relay 的签发方（我们这边，已完成）**

```
tools/webuddy-server/lib/relay-tokens.mjs   零依赖 ES256 签发（node:crypto）
GET  /api/relay/jwks                        公钥端点，免鉴权（relay 来取）
POST /api/relay/token                       给已登录用户签发 host-control token
```

线上实测输出：
```
JWKS   kty=EC crv=P-256 alg=ES256 kid=Z3EF8xgHdoHtllyA
Token  sub=liyibin  relayHostId=_FQSKWDddSd-jKLs  purpose=host-control
       iss=https://webuddyserver.cloudwaveai.cn   aud=orca-relay
```

密钥持久化在 `WEBUDDY_DATA/relay-signing-key.json`（600）——**别删**，删了所有已签发的 token 立刻失效。

**2. relay 侧要求的确切契约**（读自 `cloud/apps/relay/src/relay-token-verifier.ts`）

```
算法      ES256（EC P-256；不是 RS256。签名必须 ieee-p1363 裸 r||s，DER 会验签失败）
issuer    必须等于 ORCA_RELAY_AUTH_ISSUER
audience  必须等于 'orca-relay'
claims    sub, prof, relayHostId(/^[A-Za-z0-9_-]{16}$/ 恰好16位),
          purpose: 'host-control', exp
```

---

## 二、relay 必填配置清单

启动 `cloud/apps/relay`（**只跑这一个进程，单 cell**）：

| 变量 | 值 | 说明 |
|---|---|---|
| `ORCA_RELAY_PUBLIC_URL` | `https://webuddyserver.cloudwaveai.cn/relay` | 对外地址 |
| `ORCA_RELAY_CELL_URL` | 同上 | 单 cell 时与 PUBLIC 一致 |
| `ORCA_RELAY_CELL_ID` | `combined` | 默认值，即单进程模式 |
| `ORCA_RELAY_AUTH_ISSUER` | `https://webuddyserver.cloudwaveai.cn` | 与 token 的 iss 一致 |
| `ORCA_RELAY_JWKS_URL` | `https://webuddyserver.cloudwaveai.cn/api/relay/jwks` | 取我们的公钥 |
| `ORCA_RELAY_ASSIGNMENT_SIGNING_KEY` | 随机 ≥32 位 | 自己生成 |
| `ORCA_RELAY_DATA_DIR` | `/data/relay` | 挂载卷 |
| `DATABASE_URL` | **留空** | 留空即用本地 SQLite（`<DATA_DIR>/orca-relay.sqlite`） |
| `ORCA_RELAY_ADMIN_AUDIENCE` | 待定 | 必填但仅运维用，见下 |
| `ORCA_RELAY_DEPLOY_SERVICE_ACCOUNT` | 待定 | 必填，仅运维用 |
| `ORCA_RELAY_DIRECTOR_URL` | **不设** | 单 cell 不需要 director |

**两个必填但只服务运维的项**（`ADMIN_AUDIENCE` / `DEPLOY_SERVICE_ACCOUNT`）：
它们属于 admin token 的校验链，正常客户端流量不走。先填自洽值让它通过启动校验，
若启动失败就看它的报错再调（这是**预计会卡一轮**的地方）。

---

## 三、剩余步骤（每步可独立验证）

```
1. relay 容器起来          → curl http://127.0.0.1:8791/health 返回 200
2. nginx 加 location /relay/ → 从外网 curl .../relay/health 返回 200
3. 桌面端指向自己           → 桌面 UI 显示"已连接 relay"
4. 手机端托管 out/mobile-web → 扫码能打开配对页
5. 端到端                   → 手机打开桌面的一个会话
```

**第 2 步的 nginx 片段**（加在现有 vhost 里，复用现有证书）：
```nginx
location /relay/ {
    proxy_pass http://127.0.0.1:8791/;   # 结尾斜杠必须要有：剥掉 /relay 前缀
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;      # WebSocket 升级
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;                    # 长连接别被掐
    proxy_buffering off;
}
```
少了 `proxy_pass` 结尾那个 `/`，relay 会收到 `/relay/...` 而不是它期望的 `/`，直接 404。

**第 1 步的本机构建**（`cloud/` 是 pnpm monorepo，505 文件）：
```bash
cd cloud && pnpm install && pnpm --filter @orca/relay build
```

---

## 四、已知约束 / 坑

- **不要新增域名**：relay 挂 `/relay` 路径即可，桌面端配 `wss://webuddyserver.cloudwaveai.cn/relay/v1/connect/...`
- **前缀不能随便换**：relay 内部用绝对路径 `new URL('/v1/admin/...', publicUrl)`，
  会丢掉路径前缀。但那只用于 director↔cell 运维通道，单 cell 不走，所以不影响。
- **`cloud/` 不要打进客户端安装包**：它已被 `electron-builder.config.cjs` 排除，保持现状。
- 服务器上跑 `sh ~/services/webuddy-server/deploy/deploy.sh` 是**合并**写 `.env`，
  不会冲掉模型配置（这个 bug 已修，别改回去）。
- 服务器 curl 版本老，不认 `--retry-all-errors`。

---

## 五、相关凭据位置

```
本机 ~/.webuddy-server/         admin-password / liyibin-password
服务器 ~/services/webuddy-server/.env   LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
GitHub PAT                      用完建议吊销
```
