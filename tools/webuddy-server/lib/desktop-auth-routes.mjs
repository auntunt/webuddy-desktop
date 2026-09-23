/**
 * 桌面端（Electron 客户端）期望的认证面。
 *
 * Why 不是 OAuth：上游客户端原本走 PKCE + 系统浏览器授权页，而我们的服务器是
 * 账号密码 + 自己的 token 表。桌面端已改成直接 POST 凭据，所以这里只需把它
 * 期望的响应形状原样给出来，不必再造一套授权码流程。
 *
 * 契约被这三处固定住，改任何字段前先读它们：
 *   src/main/orca-profiles/profile-cloud-client.ts:126  cloud 摘要（email 必须非空）
 *   src/main/orca-profiles/profile-cloud-client.ts:145  会话交换体
 *   src/main/runtime/relay/relay-http-client.ts:22      relay token 响应（.strict()，只认两个字段）
 *
 * 另外两条硬约束：
 *   - capabilities.flags['relay.use'] 必须为 true，否则客户端整个 relay 永不连
 *     （src/main/runtime/relay/relay-auth-context.ts:32）
 *   - cloud.userId / cloud.cloudProfileId / cloud.activeOrgId 必须跨刷新稳定，
 *     客户端刷新后会比对这三项（profile-cloud-session-refresh.ts:193-197）
 */

import {
  findUserById,
  findUserByUsername,
  issueRefreshToken,
  issueToken,
  resolveRefreshToken,
  revokeRefreshToken,
  revokeRefreshTokensForUser,
  revokeToken,
  storeRefreshToken,
  storeToken,
  verifyPassword
} from './auth.mjs'
import { mintRelayToken, relayHostIdForPublicKey } from './relay-tokens.mjs'

// access token 只活 1 小时：客户端在到期前 60s 会主动来刷新
// （profile-cloud-session-refresh.ts:40），短一点代价只是多一次刷新。
const ACCESS_TTL_MS = 60 * 60 * 1000
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000
const RELAY_TOKEN_TTL_SECONDS = 3600

// 服务端没有组织概念。给一个固定值而不是每次现编，因为 activeOrgId 参与身份比对。
const ORG_ID = 'cloudwave'
const ORG_NAME = 'Cloudwave'

const json = (res, code, body) => {
  const text = JSON.stringify(body)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text)
  })
  res.end(text)
}

async function readJson(req, limitBytes = 64 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limitBytes) {
      throw new Error('payload too large')
    }
    chunks.push(chunk)
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

/**
 * cloud 摘要。服务端没有 email，但客户端要求它非空
 * （profile-cloud-client.ts:134 assertString），所以按用户名合成一个。
 */
function cloudSummary(user) {
  return {
    cloudProfileId: user.id,
    userId: user.username,
    email: `${user.username}@cloudwaveai.cn`,
    displayName: user.display_name ?? user.username,
    activeOrgId: ORG_ID,
    activeOrgName: ORG_NAME,
    // Why 用创建时间而不是 now：客户端会比对身份，linkedAt 每次变会让刷新看起来像换了人。
    linkedAt: Date.parse(user.created_at) || 0
  }
}

function capabilities() {
  return { flags: { 'relay.use': true }, refreshedAt: Date.now() }
}

function organizations() {
  return [{ orgId: ORG_ID, name: ORG_NAME, role: 'member' }]
}

/** 签发一对新凭证并把它们落库，然后拼出客户端要的会话交换体。 */
function mintSession(db, user) {
  const now = Date.now()
  const access = issueToken()
  const refresh = issueRefreshToken()
  storeToken(db, {
    userId: user.id,
    label: 'desktop-session',
    digest: access.digest,
    expiresAt: new Date(now + ACCESS_TTL_MS).toISOString()
  })
  storeRefreshToken(db, {
    userId: user.id,
    digest: refresh.digest,
    expiresAt: new Date(now + REFRESH_TTL_MS).toISOString()
  })
  return {
    accessToken: access.token,
    refreshToken: refresh.token,
    expiresAt: now + ACCESS_TTL_MS,
    cloud: cloudSummary(user),
    organizations: organizations(),
    capabilities: capabilities()
  }
}

function capabilitiesBody(user) {
  return {
    cloud: cloudSummary(user),
    organizations: organizations(),
    capabilities: capabilities()
  }
}

/**
 * Handle /api/desktop/*. Returns true when the route was ours, so the caller can
 * fall through to the data routes otherwise.
 *
 * `relay` carries the signing key/JWKS identity; it comes from the same place
 * `/api/relay/*` uses so both paths mint interchangeable tokens.
 */
export async function handleDesktopAuthRoute({ db, req, res, url, auth, relay }) {
  const route = url.pathname
  if (!route.startsWith('/api/desktop/')) {
    return false
  }
  if (req.method !== 'POST') {
    return (json(res, 405, { error: 'method not allowed' }), true)
  }

  // ---- 免鉴权：这两条本身就是用来换凭证的 ----
  if (route === '/api/desktop/session') {
    const body = await readJson(req)
    const row = findUserByUsername(db, String(body.username ?? ''))
    // Why 失败信息与 /api/auth/login 一致：同一个账号库，不该有两套话术。
    if (!row || row.disabled || !verifyPassword(String(body.password ?? ''), row.password_hash)) {
      return (json(res, 401, { error: '用户名或密码不对' }), true)
    }
    return (json(res, 200, mintSession(db, findUserById(db, row.id))), true)
  }

  if (route === '/api/desktop/refresh') {
    const body = await readJson(req)
    const presented = String(body.refreshToken ?? '')
    const resolved = resolveRefreshToken(db, presented)
    if (!resolved) {
      return (json(res, 401, { error: 'refresh token 无效或已过期' }), true)
    }
    // 先作废旧的那把再签发新的一对：重放同一把 refresh token 会落到上面的 401。
    revokeRefreshToken(db, presented)
    return (json(res, 200, mintSession(db, resolved.user)), true)
  }

  // ---- 以下都要带 access token ----
  if (!auth) {
    return (json(res, 401, { error: 'unauthorized' }), true)
  }
  const user = findUserById(db, auth.user.id)

  if (route === '/api/desktop/capabilities' || route === '/api/desktop/org') {
    return (json(res, 200, capabilitiesBody(user)), true)
  }

  if (route === '/api/desktop/profile') {
    return (json(res, 200, mintSession(db, user)), true)
  }

  if (route === '/api/desktop/logout') {
    const body = await readJson(req)
    if (typeof body.refreshToken === 'string' && body.refreshToken) {
      revokeRefreshToken(db, body.refreshToken)
    }
    // 退出登录要一次收干净：只吊销 refresh token 的话，当前这把 access token
    // 还能继续用满 1 小时，那就不叫退出了。
    revokeRefreshTokensForUser(db, user.id)
    revokeToken(db, auth.tokenId, user.id)
    return (json(res, 200, { ok: true }), true)
  }

  if (route === '/api/desktop/relay-token') {
    const body = await readJson(req)
    let relayHostId
    try {
      relayHostId = relayHostIdForPublicKey(body.hostPublicKeyB64)
    } catch (error) {
      return (json(res, 400, { error: String(error?.message ?? error) }), true)
    }
    // 客户端送什么值不重要，重要的是它和公钥推出来的一致 —— relay 会再算一遍。
    if (body.relayHostId !== relayHostId) {
      return (json(res, 400, { error: 'relayHostId 与主机公钥不匹配' }), true)
    }
    return (
      json(res, 200, {
        // 严格两个字段：客户端的 schema 是 .strict()，多一个就判 502
        // （relay-http-client.ts:129-132）。
        relayToken: mintRelayToken({
          privateKey: relay.privateKey,
          kid: relay.kid,
          issuer: relay.issuer,
          userId: user.username,
          relayHostId,
          ttlSeconds: RELAY_TOKEN_TTL_SECONDS
        }),
        expiresAt: Date.now() + RELAY_TOKEN_TTL_SECONDS * 1000
      }),
      true
    )
  }

  return (json(res, 404, { error: 'not found' }), true)
}
