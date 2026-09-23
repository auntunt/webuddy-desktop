# 阶段 1：数据打通（强制登录 + 采集器凭证）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 成员打开 Webuddy 必须先登录；登录后采集器自动拿到本人专属的上传凭证并开始上报，app 内能看到上报状态。

**Architecture:** 服务端新增"采集器 token"（label `collector:<deviceId>`，90 天，只能调 `/api/ingest`）。桌面主进程在登录、每次采集前同步这个 token 到 `~/.webuddy-agent/config.json`；退出/会话失效时清掉。采集器 push 遇 401 立即停止并写 `last-push.json`，主进程据此重新签发。渲染层在 `App` 外包一层登录闸门。

**Tech Stack:** Node ≥22.5 零依赖服务端（node:http、node:sqlite、node:test）；Electron 主进程 TypeScript + vitest；React 渲染层。

**Spec:** `tools/webuddy-server/docs/2026-09-23-team-monitoring-dashboard-design.md` 第 4 节

## Global Constraints

- 服务端与采集器保持零第三方依赖；测试用 `node --test`。
- 桌面端遵守仓库 `AGENTS.md`：注释简短只写 Why；不加 `max-lines` 豁免（单文件 ≤300 行）；类型断言需 `SAFETY:` 注释；UI 用 `components/ui/` 原语与 `main.css` token；子进程走 `src/shared/child-process/`（已有 `session-collector.ts` 用 `node:child_process` 的 spawn 属存量，不扩大）。
- 验证命令：`pnpm tc:node`、`pnpm tc:web`（渲染层）、`pnpm test <path>`、`npx oxlint <files>`。
- 与设计的一处偏差：登录页**不提供服务器地址输入**，沿用 `ORCA_CLOUD_API_URL` 环境变量（开发用）+ 打包内置线上地址。理由：YAGNI，避免持久化覆盖配置。
- 采集器 token 续期：剩余 < 30 天或采集器报 401 时重新签发。
- 退出登录时服务端吊销该用户**所有** `collector:%` token；其他设备下次采集前收到 401 后自动重签（其桌面会话仍有效）。

---

### Task 1: 服务端 — 采集器 token 签发、权限限制、退出吊销

**Files:**

- Modify: `tools/webuddy-server/lib/auth.mjs`（`resolveToken` 返回 `label`；新增 `issueCollectorToken`、`revokeCollectorTokensForUser`、`isRouteAllowedForToken`）
- Modify: `tools/webuddy-server/lib/desktop-auth-routes.mjs`（新路由 `/api/desktop/collector-token`；logout 追加吊销）
- Modify: `tools/webuddy-server/server.mjs`（401 闸之后加 `isRouteAllowedForToken` 检查）
- Modify: `tools/webuddy-server/package.json`（`"scripts": {"test": "node --test test/"}`）
- Create: `tools/webuddy-server/test/collector-token.test.mjs`

**Interfaces:**

- Produces: `POST /api/desktop/collector-token`，请求头 `Authorization: Bearer <desktop access token>`，body `{ deviceId: string }` → `200 { token: string, userId: string, expiresAt: number }`；deviceId 缺失/非字符串/长度>128 → 400。
- Produces: `resolveToken(db, token)` → `{ user, tokenId, label }`。
- Produces: `isRouteAllowedForToken(auth, route): boolean` — label 以 `collector:` 开头时仅 `route === '/api/ingest'` 为 true。

- [ ] **Step 1: 写失败测试**

```js
// tools/webuddy-server/test/collector-token.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../lib/db.mjs'
import {
  createUser,
  issueCollectorToken,
  isRouteAllowedForToken,
  resolveToken,
  revokeCollectorTokensForUser
} from '../lib/auth.mjs'

function freshDb() {
  return openDb(join(mkdtempSync(join(tmpdir(), 'wb-')), 'test.sqlite'))
}

test('collector token resolves with its label and only reaches ingest', () => {
  const db = freshDb()
  const user = createUser(db, { username: 'lina', password: 'password1' })
  const issued = issueCollectorToken(db, { userId: user.id, deviceId: 'dev-1' })
  const auth = resolveToken(db, issued.token)
  assert.equal(auth.user.username, 'lina')
  assert.equal(auth.label, 'collector:dev-1')
  assert.equal(isRouteAllowedForToken(auth, '/api/ingest'), true)
  assert.equal(isRouteAllowedForToken(auth, '/api/sessions'), false)
  assert.equal(isRouteAllowedForToken({ ...auth, label: 'desktop-session' }, '/api/sessions'), true)
})

test('reissuing for the same device revokes the previous token', () => {
  const db = freshDb()
  const user = createUser(db, { username: 'lina', password: 'password1' })
  const first = issueCollectorToken(db, { userId: user.id, deviceId: 'dev-1' })
  const second = issueCollectorToken(db, { userId: user.id, deviceId: 'dev-1' })
  assert.equal(resolveToken(db, first.token), null)
  assert.ok(resolveToken(db, second.token))
})

test('expiry is 90 days out', () => {
  const db = freshDb()
  const user = createUser(db, { username: 'lina', password: 'password1' })
  const { expiresAt } = issueCollectorToken(db, { userId: user.id, deviceId: 'd' })
  const days = (expiresAt - Date.now()) / 86_400_000
  assert.ok(days > 89.9 && days <= 90)
})

test('sign-out revokes every collector token of the user, not others', () => {
  const db = freshDb()
  const lina = createUser(db, { username: 'lina', password: 'password1' })
  const bo = createUser(db, { username: 'bo', password: 'password1' })
  const a = issueCollectorToken(db, { userId: lina.id, deviceId: 'd1' })
  const b = issueCollectorToken(db, { userId: lina.id, deviceId: 'd2' })
  const c = issueCollectorToken(db, { userId: bo.id, deviceId: 'd3' })
  revokeCollectorTokensForUser(db, lina.id)
  assert.equal(resolveToken(db, a.token), null)
  assert.equal(resolveToken(db, b.token), null)
  assert.ok(resolveToken(db, c.token))
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd tools/webuddy-server && node --test test/`
Expected: FAIL，`issueCollectorToken` 未导出。

- [ ] **Step 3: 实现 auth.mjs 部分**

在 `auth.mjs` 中：

- `resolveToken` 的 return 改为 `return { user, tokenId: row.id, label: row.label ?? null }`。
- 追加：

```js
const COLLECTOR_LABEL_PREFIX = 'collector:'
const COLLECTOR_TTL_MS = 90 * 24 * 60 * 60 * 1000

/** 每台设备一把；重签即作废同设备旧的，避免泄露的旧 token 继续可用。 */
export function issueCollectorToken(db, { userId, deviceId }) {
  const label = `${COLLECTOR_LABEL_PREFIX}${deviceId}`
  db.prepare(
    'UPDATE api_tokens SET revoked_at = ? WHERE user_id = ? AND label = ? AND revoked_at IS NULL'
  ).run(new Date().toISOString(), userId, label)
  const { token, digest } = issueToken()
  const expiresAt = Date.now() + COLLECTOR_TTL_MS
  storeToken(db, { userId, label, digest, expiresAt: new Date(expiresAt).toISOString() })
  return { token, expiresAt }
}

export function revokeCollectorTokensForUser(db, userId) {
  return db
    .prepare(
      "UPDATE api_tokens SET revoked_at = ? WHERE user_id = ? AND label LIKE 'collector:%' AND revoked_at IS NULL"
    )
    .run(new Date().toISOString(), userId).changes
}

/** 采集器 token 只用于上传：它常驻在磁盘上，泄露时不该能读任何人的正文。 */
export function isRouteAllowedForToken(auth, route) {
  if (typeof auth?.label === 'string' && auth.label.startsWith(COLLECTOR_LABEL_PREFIX)) {
    return route === '/api/ingest'
  }
  return true
}
```

- [ ] **Step 4: 路由与闸门**

`desktop-auth-routes.mjs`：import 新增 `issueCollectorToken, revokeCollectorTokensForUser`。在 `/api/desktop/relay-token` 分支之前加：

```js
if (route === '/api/desktop/collector-token') {
  const body = await readJson(req)
  const deviceId = body.deviceId
  if (typeof deviceId !== 'string' || !deviceId || deviceId.length > 128) {
    return (json(res, 400, { error: 'deviceId required' }), true)
  }
  const issued = issueCollectorToken(db, { userId: user.id, deviceId })
  return (
    json(res, 200, { token: issued.token, userId: user.username, expiresAt: issued.expiresAt }),
    true
  )
}
```

logout 分支中 `revokeRefreshTokensForUser(db, user.id)` 之后加一行 `revokeCollectorTokensForUser(db, user.id)`。

注意：采集器 token 本身不能调用 `/api/desktop/*`。在 `handleDesktopAuthRoute` 的 `if (!auth)` 检查处改为 `if (!auth || !isRouteAllowedForToken(auth, route))`（从 `auth.mjs` import）。

`server.mjs`：import `isRouteAllowedForToken`；在 `handleAuthRoute` 调用**之前**加：

```js
if (auth && !isRouteAllowedForToken(auth, route)) {
  return json(res, 401, { error: 'unauthorized' })
}
```

（放在 `const auth = authenticate(req, url)` 之后，这样 `/api/auth/*`、`/api/desktop/*` 和数据接口都被覆盖。）

`package.json` 加 `"scripts": { "test": "node --test test/" }`。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd tools/webuddy-server && node --test test/`
Expected: 4 tests PASS。

- [ ] **Step 6: 冒烟**

```bash
cd tools/webuddy-server && WEBUDDY_PORT=8799 WEBUDDY_DATA=$(mktemp -d) WEBUDDY_ADMIN_USER=admin WEBUDDY_ADMIN_PASSWORD=adminpass1 node server.mjs &
sleep 1
AT=$(curl -s -XPOST localhost:8799/api/desktop/session -d '{"username":"admin","password":"adminpass1"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
CT=$(curl -s -XPOST localhost:8799/api/desktop/collector-token -H "authorization: Bearer $AT" -d '{"deviceId":"d1"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -s -o /dev/null -w '%{http_code}\n' localhost:8799/api/sessions -H "authorization: Bearer $CT"   # 期望 401
kill %1
```

（若 bootstrap admin 的环境变量名不同，以 `server.mjs` 中 `ensureBootstrapAdmin` 的调用为准。）

- [ ] **Step 7: Commit**

```bash
git add tools/webuddy-server
git commit -m "feat(webuddy-server): 采集器专用 token（按设备签发、仅限上传、退出即吊销）"
```

---

### Task 2: 采集器 — 401 立即停止并落盘上传结果

**Files:**

- Modify: `tools/webuddy-agent/lib/upload.mjs`（`pushPending` 遇 401 停止，返回 `authRejected: true`）
- Modify: `tools/webuddy-agent/index.mjs`（`push` 命令把结果写入 `paths.lastPush`）
- Modify: `tools/webuddy-agent/lib/state.mjs`（`paths.lastPush = join(STATE_DIR, 'last-push.json')`）
- Modify: `tools/webuddy-agent/package.json`（`"scripts": {"test": "node --test test/"}`）
- Create: `tools/webuddy-agent/test/upload.test.mjs`

**Interfaces:**

- Produces: `~/.webuddy-agent/last-push.json` 形状 `{ at: string(ISO), pushed: number, failed: number, exhausted: number, authRejected: boolean, skipped?: string, error?: string }`。桌面端 Task 3/4 读取它。

- [ ] **Step 1: 读 `upload.mjs` 全文**，确认 `pushPending` 的批处理循环结构（第 91–150 行），以及它如何从 `paths.outbox` 读待传文件。测试需要把 `WEBUDDY_AGENT_HOME` 指向临时目录，**在 import 模块之前**设置（`state.mjs` 在模块加载时读取它）。

- [ ] **Step 2: 写失败测试**

```js
// tools/webuddy-agent/test/upload.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'wba-'))
process.env.WEBUDDY_AGENT_HOME = home
const { pushPending } = await import('../lib/upload.mjs')
const { paths } = await import('../lib/state.mjs')

function queue(n) {
  mkdirSync(paths.outbox, { recursive: true })
  for (let i = 0; i < n; i++) {
    // 形状须与 upload.mjs 读取 outbox 的格式一致；读完 Step 1 后按实际格式调整。
    writeFileSync(
      join(paths.outbox, `r${i}.json`),
      JSON.stringify({ record: { session: { id: `s${i}` } } })
    )
  }
}

test('401 stops the push and reports authRejected without burning retries', async () => {
  queue(3)
  let calls = 0
  const result = await pushPending({
    endpoint: 'http://x/api/ingest',
    token: 't',
    deviceId: 'd',
    fetchImpl: async () => {
      calls += 1
      return new Response('{}', { status: 401 })
    }
  })
  assert.equal(result.authRejected, true)
  assert.equal(result.pushed, 0)
  assert.equal(calls, 1)
  assert.equal(readdirSync(paths.outbox).filter((f) => f.endsWith('.json')).length, 3)
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd tools/webuddy-agent && node --test test/`
Expected: FAIL（`authRejected` undefined 或 calls > 1）。

- [ ] **Step 4: 实现**

在 `pushPending` 的请求处，`!response.ok` 抛错之前加：

```js
if (response.status === 401) {
  // Why 立即停：凭证失效时继续重试只会把每条记录的重试次数耗到 exhausted。
  return { pushed, failed, exhausted, authRejected: true }
}
```

其余 return 语句补 `authRejected: false`。401 分支不得递增该批记录的失败计数。

`index.mjs` 的 `push` 分支：

```js
const result = await pushPending({ endpoint: config.endpoint, token: config.token, deviceId })
await writeJson(paths.lastPush, { at: new Date().toISOString(), authRejected: false, ...result })
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
```

并用 try/catch 包住：抛错时写 `{ at, pushed: 0, failed: 0, exhausted: 0, authRejected: false, error: String(error?.message ?? error) }` 后再抛出。`writeJson` 从 `state.mjs` import（已导出）。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd tools/webuddy-agent && node --test test/`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add tools/webuddy-agent
git commit -m "feat(webuddy-agent): 上传遇 401 立即停止并记录 last-push.json"
```

---

### Task 3: 桌面主进程 — 采集器凭证同步

**Files:**

- Rewrite: `src/main/webuddy/auth.ts` → 重命名为 `src/main/webuddy/collector-config.ts`（保留 `collectorConfigPath`、`readConfig`、`writeConfig`；删除未被引用的 `login`/`logout`/`status`/`authOrigin`/`DEFAULT_ORIGIN` 及类型）
- Create: `src/main/webuddy/collector-credential.ts`
- Create: `src/main/webuddy/collector-credential.test.ts`
- Modify: `src/main/webuddy/session-collector.ts`（`startSessionCollection` 新增 `beforeRun?: () => Promise<void>`；`sessionCollectorEnv` 不再注入默认 `WEBUDDY_ENDPOINT`，仅在 `base.WEBUDDY_ENDPOINT` 存在时透传；删除 `DEFAULT_INGEST_ENDPOINT`）
- Modify: `src/main/index.ts:118`（传入 `beforeRun`）
- Modify: `src/main/startup/main-window-core-services.ts:93-97`（auth mutation → sync；sign-out → clear）
- 以及在主进程初始化处订阅 `onOrcaCloudSessionInvalidated` → clear（放在 `main-window-core-services.ts` 同一位置，注意取消订阅的生命周期与窗口一致）

**Interfaces:**

- Consumes: `POST {apiBaseUrl}/api/desktop/collector-token`（Task 1）；`last-push.json`（Task 2）；`getOrcaCloudAuthConfig()`（`profile-cloud-auth-config.ts`）；`ensureActiveOrcaProfile(userDataPath)`（`profile-index-store`）；`runWithFreshOrcaCloudSession(config, active, userDataPath, op)`（`profile-cloud-session-refresh.ts:271`）；`getProfileUserDataPath()`。
- Produces:
  - `collector-config.ts`：`collectorConfigPath(env?)`, `collectorStateDir(env?)`, `readCollectorConfig(path)`, `writeCollectorConfig(path, obj)`, `readLastPush(env?) → LastPush | null`, `ensureCollectorDeviceId(env?) → Promise<string>`
  - `collector-credential.ts`：`syncCollectorCredential(deps?) → Promise<'issued' | 'unchanged' | 'cleared' | 'skipped'>`, `clearCollectorCredential(env?) → Promise<void>`, 纯函数 `needsCollectorReissue(input) → boolean`
  - `type LastPush = { at: string; pushed: number; failed: number; exhausted: number; authRejected: boolean; error?: string }`

- [ ] **Step 1: 写失败测试（纯函数 + 文件读写）**

```ts
// src/main/webuddy/collector-credential.test.ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clearCollectorCredential, needsCollectorReissue } from './collector-credential'
import { ensureCollectorDeviceId } from './collector-config'

const DAY = 86_400_000
const now = Date.UTC(2026, 8, 23)

describe('needsCollectorReissue', () => {
  const base = {
    now,
    config: { token: 'wb_x', userId: 'lina', tokenExpiresAt: now + 60 * DAY },
    signedInUserId: 'lina',
    lastPush: null
  }
  it('keeps a healthy token', () => {
    expect(needsCollectorReissue(base)).toBe(false)
  })
  it('reissues when missing', () => {
    expect(needsCollectorReissue({ ...base, config: {} })).toBe(true)
  })
  it('reissues when another person signed in', () => {
    expect(needsCollectorReissue({ ...base, signedInUserId: 'bo' })).toBe(true)
  })
  it('reissues inside the 30-day window', () => {
    expect(
      needsCollectorReissue({ ...base, config: { ...base.config, tokenExpiresAt: now + 29 * DAY } })
    ).toBe(true)
  })
  it('reissues after the collector reported 401 with this token', () => {
    expect(
      needsCollectorReissue({
        ...base,
        lastPush: {
          at: new Date(now).toISOString(),
          pushed: 0,
          failed: 0,
          exhausted: 0,
          authRejected: true
        }
      })
    ).toBe(true)
  })
})

describe('collector config files', () => {
  it('clear removes credentials but keeps other settings', async () => {
    const home = await mkdtemp(join(tmpdir(), 'wbc-'))
    const env = { WEBUDDY_AGENT_HOME: home }
    await writeFile(
      join(home, 'config.json'),
      JSON.stringify({ token: 't', userId: 'u', tokenExpiresAt: 1, deviceLabel: 'mac' })
    )
    await clearCollectorCredential(env)
    expect(JSON.parse(await readFile(join(home, 'config.json'), 'utf8'))).toEqual({
      deviceLabel: 'mac'
    })
  })
  it('device id is created once and reused (same file the collector uses)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'wbc-'))
    const env = { WEBUDDY_AGENT_HOME: home }
    const a = await ensureCollectorDeviceId(env)
    const b = await ensureCollectorDeviceId(env)
    expect(a).toBe(b)
    expect(JSON.parse(await readFile(join(home, 'device.json'), 'utf8')).deviceId).toBe(a)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/main/webuddy/collector-credential.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `collector-config.ts`**

由 `auth.ts` 重命名而来（`git mv`）。保留顶部 Why 注释的主旨（两边读同一个文件，一台机器一个身份）。

```ts
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export type LastPush = {
  at: string
  pushed: number
  failed: number
  exhausted: number
  authRejected: boolean
  error?: string
}

export function collectorStateDir(env: NodeJS.ProcessEnv = process.env): string {
  // 与采集器 lib/state.mjs 的解析顺序保持一致。
  return env.WEBUDDY_AGENT_HOME || join(env.WEBUDDY_HOME || homedir(), '.webuddy-agent')
}

export function collectorConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(collectorStateDir(env), 'config.json')
}

async function readJsonObject(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? { ...parsed }
      : null
  } catch {
    return null
  }
}

export async function readCollectorConfig(path: string): Promise<Record<string, unknown>> {
  return (await readJsonObject(path)) ?? {}
}

export async function writeCollectorConfig(
  path: string,
  config: Record<string, unknown>
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  // Why 600: the file holds a bearer token.
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  await chmod(path, 0o600).catch(() => undefined)
}

export async function readLastPush(env: NodeJS.ProcessEnv = process.env): Promise<LastPush | null> {
  const raw = await readJsonObject(join(collectorStateDir(env), 'last-push.json'))
  if (!raw || typeof raw.at !== 'string') {
    return null
  }
  const num = (v: unknown): number => (typeof v === 'number' ? v : 0)
  return {
    at: raw.at,
    pushed: num(raw.pushed),
    failed: num(raw.failed),
    exhausted: num(raw.exhausted),
    authRejected: raw.authRejected === true,
    ...(typeof raw.error === 'string' ? { error: raw.error } : {})
  }
}

/** Why 同一个 device.json：服务端按设备签 token，必须和采集器上报的 deviceId 一致。 */
export async function ensureCollectorDeviceId(
  env: NodeJS.ProcessEnv = process.env
): Promise<string> {
  const path = join(collectorStateDir(env), 'device.json')
  const existing = await readJsonObject(path)
  if (typeof existing?.deviceId === 'string' && existing.deviceId) {
    return existing.deviceId
  }
  const deviceId = randomUUID()
  await writeCollectorConfig(path, { deviceId, createdAt: new Date().toISOString() })
  return deviceId
}
```

- [ ] **Step 4: 实现 `collector-credential.ts`**

```ts
import { ensureActiveOrcaProfile } from '../orca-profiles/profile-index-store'
import { getOrcaCloudAuthConfig } from '../orca-profiles/profile-cloud-auth-config'
import { runWithFreshOrcaCloudSession } from '../orca-profiles/profile-cloud-session-refresh'
import { getProfileUserDataPath } from '../orca-profiles/profile-storage-paths'
import {
  collectorConfigPath,
  ensureCollectorDeviceId,
  readCollectorConfig,
  readLastPush,
  writeCollectorConfig,
  type LastPush
} from './collector-config'

const RENEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const CREDENTIAL_KEYS = ['token', 'userId', 'tokenExpiresAt'] as const

export function needsCollectorReissue(input: {
  now: number
  config: Record<string, unknown>
  signedInUserId: string
  lastPush: LastPush | null
}): boolean {
  const { config } = input
  if (typeof config.token !== 'string' || !config.token) return true
  if (config.userId !== input.signedInUserId) return true
  if (
    typeof config.tokenExpiresAt !== 'number' ||
    config.tokenExpiresAt - input.now < RENEW_WINDOW_MS
  )
    return true
  return input.lastPush?.authRejected === true
}

export async function clearCollectorCredential(
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const path = collectorConfigPath(env)
  const config = await readCollectorConfig(path)
  for (const key of CREDENTIAL_KEYS) delete config[key]
  await writeCollectorConfig(path, config)
}

/**
 * Keeps ~/.webuddy-agent/config.json holding the signed-in person's upload
 * token. Never throws: collection must not break the app.
 */
export async function syncCollectorCredential(
  env: NodeJS.ProcessEnv = process.env
): Promise<'issued' | 'unchanged' | 'cleared' | 'skipped'> {
  try {
    const configState = getOrcaCloudAuthConfig()
    if (!configState.configured) return 'skipped'
    const userDataPath = getProfileUserDataPath()
    const active = ensureActiveOrcaProfile(userDataPath)
    const cloud = active.profile.cloud
    if (!cloud) {
      await clearCollectorCredential(env)
      return 'cleared'
    }
    const path = collectorConfigPath(env)
    const config = await readCollectorConfig(path)
    const lastPush = await readLastPush(env)
    if (
      !needsCollectorReissue({ now: Date.now(), config, signedInUserId: cloud.userId, lastPush })
    ) {
      return 'unchanged'
    }
    const deviceId = await ensureCollectorDeviceId(env)
    const apiBaseUrl = configState.config.apiBaseUrl
    const result = await runWithFreshOrcaCloudSession(
      configState.config,
      active,
      userDataPath,
      async (session) => {
        const response = await fetch(new URL('/api/desktop/collector-token', `${apiBaseUrl}/`), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${session.accessToken}`
          },
          body: JSON.stringify({ deviceId })
        })
        if (!response.ok) {
          // 形状需满足 isOrcaCloudAuthFailure 的判定，才能触发刷新重试 —— 实现时读 profile-cloud-session-refresh.ts:44 对齐。
          throw Object.assign(new Error(`collector-token ${response.status}`), {
            status: response.status
          })
        }
        return (await response.json()) as { token: string; userId: string; expiresAt: number }
      }
    )
    if (result.status !== 'ok') {
      await clearCollectorCredential(env)
      return 'cleared'
    }
    await writeCollectorConfig(path, {
      ...config,
      endpoint: new URL('/api/ingest', `${apiBaseUrl}/`).toString(),
      token: result.value.token,
      userId: result.value.userId,
      tokenExpiresAt: result.value.expiresAt
    })
    return 'issued'
  } catch (error) {
    console.warn(
      '[webuddy] collector credential sync failed:',
      error instanceof Error ? error.message : String(error)
    )
    return 'skipped'
  }
}
```

实现要点：

- `response.json()` 的 `as` 断言必须改为运行时校验（写一个 `parseCollectorTokenResponse(unknown)`，字段不对就 throw），不要留 `as`。
- 抛出的错误要让 `isOrcaCloudAuthFailure`（`profile-cloud-session-refresh.ts:44`）识别 401 —— 读该函数，复用它期望的错误类型（可能是 `profile-cloud-client.ts` 里的某个 Error 子类），不要自造形状。
- 若单文件超过 300 行，把 `needsCollectorReissue` + `clearCollectorCredential` 拆到 `collector-credential-policy.ts`。

- [ ] **Step 5: 接线**

`session-collector.ts`：

```ts
export function startSessionCollection(options: { ...; beforeRun?: () => Promise<unknown> } = {}): void
// kick 内 collectOnce 之前：
      await options.beforeRun?.()
```

`sessionCollectorEnv`：删掉默认 endpoint 注入，改为

```ts
    ...(base.WEBUDDY_ENDPOINT ? { WEBUDDY_ENDPOINT: base.WEBUDDY_ENDPOINT } : {})
```

同步更新其 Why 注释：endpoint 与 token 都由 `collector-credential.ts` 写进 config.json。同时 grep `DEFAULT_INGEST_ENDPOINT` 的其他引用一并处理。

`index.ts:118`：`startSessionCollection({ beforeRun: () => syncCollectorCredential() })`。

`main-window-core-services.ts`：

```ts
      onOrcaProfileAuthMutation: () => {
        state.desktopRelayService?.authMutated()
        void syncCollectorCredential()
      },
      onBeforeOrcaProfileSignOut: () => {
        state.desktopRelayService?.fenceAndCloseNow(RELAY_HOST_CLOSE_REASON.SIGNED_OUT)
        void clearCollectorCredential()
      },
```

并在同文件合适的初始化位置 `onOrcaCloudSessionInvalidated(() => void clearCollectorCredential())`（仅注册一次；若该函数会随窗口重建多次调用，改放 `index.ts` 的 whenReady 里）。

- [ ] **Step 6: 验证**

Run: `pnpm test src/main/webuddy && pnpm tc:node && npx oxlint src/main/webuddy src/main/index.ts src/main/startup/main-window-core-services.ts`
Expected: 全部通过。

- [ ] **Step 7: Commit**

```bash
git add src/main/webuddy src/main/index.ts src/main/startup/main-window-core-services.ts
git commit -m "feat(webuddy): 登录即为采集器签发上传凭证，退出/失效即清除"
```

---

### Task 4: 采集状态 IPC

**Files:**

- Create: `src/main/webuddy/collector-status.ts`（`readCollectorStatus(env?) → Promise<WebuddyCollectorStatus>`）
- Create: `src/main/webuddy/collector-status.test.ts`
- Create: `src/shared/webuddy-collector.ts`（`WebuddyCollectorStatus` 类型）
- Create: `src/main/ipc/webuddy-collector-handlers.ts`（`ipcMain.handle('webuddy:collectorStatus', …)`）
- Modify: `src/main/ipc/register-core-handlers/register-core-handlers.ts`（注册）
- Create/Modify: preload —— 按 `src/preload/api/orca-profile-api.ts` + `orca-profiles-bridge.ts` 的模式新增 `webuddyCollector: { status: () => Promise<WebuddyCollectorStatus> }`；web 端 preload-api（`src/renderer/src/web/preload-api/`）若要求所有 api key 齐全，提供返回 `{ linked: false, … }` 的桩。

**Interfaces:**

- Produces:

```ts
export type WebuddyCollectorStatus = {
  linked: boolean // config.json 有 token
  userId: string | null
  lastPush: {
    at: string
    pushed: number
    failed: number
    authRejected: boolean
    error?: string
  } | null
  pending: number // outbox 中 *.json 数
}
```

- [ ] **Step 1: 写失败测试**：临时 `WEBUDDY_AGENT_HOME` 下写 `config.json`（有 token/userId）、`last-push.json`、`outbox/a.json`、`outbox/b.json`、`outbox/c.tmp`；断言 `readCollectorStatus(env)` 返回 `linked: true, userId, pending: 2, lastPush.pushed`。再测空目录返回 `{ linked: false, userId: null, lastPush: null, pending: 0 }`。
- [ ] **Step 2: 跑测试确认失败**：`pnpm test src/main/webuddy/collector-status.test.ts`
- [ ] **Step 3: 实现**：用 `collector-config.ts` 的读取函数；outbox 用 `readdir(join(collectorStateDir(env), 'outbox'))`，目录不存在返回 0。
- [ ] **Step 4: 接 IPC 与 preload**，`pnpm tc:node && pnpm tc:web`。
- [ ] **Step 5: 跑测试确认通过**
- [ ] **Step 6: Commit** `feat(webuddy): 采集状态 IPC`

---

### Task 5: 渲染层 — 强制登录闸门 + 账号面板显示采集状态

**Files:**

- Create: `src/renderer/src/components/webuddy-auth/WebuddyAuthGate.tsx`
- Create: `src/renderer/src/components/webuddy-auth/WebuddyLoginScreen.tsx`
- Create: `src/renderer/src/components/webuddy-auth/WebuddyAuthGate.test.tsx`
- Modify: `src/renderer/src/main.tsx`（`<App />` 外包 `<WebuddyAuthGate>`）
- Modify: `src/renderer/src/components/settings/OrcaAccountSettingsPane.tsx`（已登录时显示采集状态行）

**Interfaces:**

- Consumes: `window.api.orcaProfiles.authStatus()`、`.signIn({username,password})`、`.onAuthStatusChanged(cb)`；`window.api.webuddyCollector.status()`（Task 4）。
- 已登录判定：`auth.state === 'connected'`。`state === 'unconfigured'`（开发环境未配 `ORCA_CLOUD_API_URL`）时**放行**并在控制台 warn，否则本地开发无法启动。

- [ ] **Step 1: 读** `OrcaAccountSettingsPane.tsx` 里现有的用户名/密码登录表单，以及 `store/slices/orca-profiles-auth-actions.ts:84` 的 `signInCurrentOrcaProfile` 对错误结果的处理 —— 登录页复用同样的错误文案映射（抽成共享函数，不要复制）。
- [ ] **Step 2: 写失败测试**（vitest + testing-library，参照 `OrcaAccountSettingsPane.test.tsx` 的 `window.api` mock 方式）：
  - authStatus 返回 `state: 'local'` → 渲染登录页、不渲染 children。
  - 提交表单 → 调 `signIn`，返回 `status: 'connected'` → 渲染 children。
  - signIn 返回 `failed` → 显示错误、仍在登录页。
  - 已登录后 `onAuthStatusChanged` 回调触发且新 authStatus 为 `reconnect-required` → 回到登录页。
  - `state: 'unconfigured'` → 直接渲染 children。
- [ ] **Step 3: 跑测试确认失败**：`pnpm test src/renderer/src/components/webuddy-auth`
- [ ] **Step 4: 实现**。
  - `WebuddyAuthGate`：`status: 'loading' | 'locked' | 'open'`；loading 时渲染空白背景（`bg-background`），避免闪出登录页。
  - `WebuddyLoginScreen`：全屏居中卡片，标题"登录 Webuddy"，说明"使用公司账号登录。登录后会自动上报本机 AI coding 使用记录。"，用户名、密码、登录按钮；使用 `components/ui/` 的 `Input`、`Button`、`Label`；窗口可拖动区域参照 `app-window-chrome.ts`（mac 红绿灯位置留白，`-webkit-app-region: drag` 的用法看现有 titlebar 组件）。文案走 i18n `translate('webuddyAuth.*', 默认中文)`，参照现有 `translate` 用法。
  - `main.tsx`：`<WebuddyAuthGate><App /></WebuddyAuthGate>`，放在 `RecoverableRenderErrorBoundary` 内。
- [ ] **Step 5: 账号面板**：在已登录区域加一个小节"使用数据上报"：`上次上报：<相对时间>，成功 N 条`、`待上报：N 条`；`authRejected` 或 `error` 时用 destructive 文字显示；`linked=false` 时显示"尚未开始上报"。打开面板时拉一次 status。
- [ ] **Step 6: 验证**：`pnpm test src/renderer/src/components/webuddy-auth src/renderer/src/components/settings/OrcaAccountSettingsPane.test.tsx && pnpm tc:web && pnpm run check:code-quality:changed`
- [ ] **Step 7: Commit** `feat(webuddy): 启动强制登录，账号面板显示上报状态`

---

### Task 6: 端到端验证

- [ ] **Step 1**：本地起服务端（Task 1 Step 6 的方式，端口 8799，建一个 member 账号）。
- [ ] **Step 2**：`ORCA_CLOUD_API_URL=http://127.0.0.1:8799 ORCA_BACKGROUND_LAUNCH=1` 以开发模式后台启动 app（按 `$electron` skill / 仓库 README 的 dev 启动方式），用 Playwright CDP 截图：未登录 → 登录页；用 member 登录 → 工作区出现。
- [ ] **Step 3**：检查 `~/.webuddy-agent/config.json`（测试时用 `WEBUDDY_AGENT_HOME` 指向临时目录，避免覆盖真实配置）包含 token/userId/endpoint/tokenExpiresAt。
- [ ] **Step 4**：手动触发一次采集（把 `firstRunDelayMs` 通过环境变量缩短不可行时，直接 `ELECTRON_RUN_AS_NODE=1 WEBUDDY_AGENT_HOME=… node tools/webuddy-agent/index.mjs scan && … push`），确认服务端 `/api/sessions` 用 member 的桌面 token 可查到记录，`last-push.json` 生成。
- [ ] **Step 5**：退出登录 → 回到登录页、config.json 无 token、服务端该 collector token 已吊销。
- [ ] **Step 6**：`pnpm tc` 全量、`pnpm test src/main/webuddy src/renderer/src/components/webuddy-auth src/main/orca-profiles src/main/ipc`、两个 tools 的 `node --test`。
