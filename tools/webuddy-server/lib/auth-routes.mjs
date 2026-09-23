/**
 * Authentication and user-administration routes.
 *
 * Kept separate from the data routes so the ownership boundary is obvious:
 * everything here decides *who you are*, and `server.mjs` then decides *what
 * you may read*.
 */

import {
  createUser,
  findUserByUsername,
  issueToken,
  listTokens,
  revokeToken,
  revokeTokenAsAdmin,
  storeToken,
  updateUser,
  verifyPassword,
  PUBLIC_USER_COLUMNS
} from './auth.mjs'
import { attachGroupName } from './group-routes.mjs'

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
 * Handle /api/auth/* and /api/admin/*. Returns true when the route was ours,
 * so the caller can fall through to data routes otherwise.
 */
export async function handleAuthRoute({ db, req, res, url, auth }) {
  const route = url.pathname
  const isAuth = route.startsWith('/api/auth/')
  // /api/admin/groups* is handled by group-routes.mjs, not here.
  const isAdmin = route.startsWith('/api/admin/') && !route.startsWith('/api/admin/groups')
  if (!isAuth && !isAdmin) {
    return false
  }

  if (req.method === 'POST' && route === '/api/auth/login') {
    const body = await readJson(req)
    const row = findUserByUsername(db, String(body.username ?? ''))
    // Why one message for both failures: telling an attacker which half was
    // wrong turns login into a username oracle.
    if (!row || row.disabled || !verifyPassword(String(body.password ?? ''), row.password_hash)) {
      return (json(res, 401, { error: '用户名或密码不对' }), true)
    }
    const { token, digest } = issueToken()
    storeToken(db, {
      userId: row.id,
      label: String(body.label ?? 'login'),
      digest,
      expiresAt: body.expiresAt ?? null
    })
    const user = db.prepare(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ?`).get(row.id)
    // Same shape as /api/auth/me, so the header shows the group right after login.
    return (json(res, 200, { token, user: attachGroupName(db, user) }), true)
  }

  if (!auth) {
    return (json(res, 401, { error: 'unauthorized' }), true)
  }

  if (route === '/api/auth/me' && req.method === 'GET') {
    return (
      json(res, 200, {
        user: attachGroupName(db, auth.user),
        tokens: listTokens(db, auth.user.id)
      }),
      true
    )
  }

  if (route === '/api/auth/tokens' && req.method === 'GET') {
    return (json(res, 200, { tokens: listTokens(db, auth.user.id) }), true)
  }

  if (route === '/api/auth/tokens' && req.method === 'POST') {
    const body = await readJson(req)
    const { token, digest } = issueToken()
    const id = storeToken(db, {
      userId: auth.user.id,
      label: String(body.label ?? 'manual'),
      digest,
      expiresAt: body.expiresAt ?? null
    })
    // The only time the plaintext token is ever returned.
    return (json(res, 201, { id, token }), true)
  }

  if (route.startsWith('/api/auth/tokens/') && req.method === 'DELETE') {
    const id = decodeURIComponent(route.slice('/api/auth/tokens/'.length))
    return (json(res, 200, { revoked: revokeToken(db, id, auth.user.id) }), true)
  }

  if (isAdmin) {
    if (auth.user.role !== 'admin') {
      return (json(res, 403, { error: '需要管理员权限' }), true)
    }

    if (route === '/api/admin/users' && req.method === 'GET') {
      // Why joined here rather than in the client: "is this account actually
      // being used?" is the first question an admin asks, and it is one query.
      const users = db
        .prepare(
          `SELECT u.id, u.username, u.display_name, u.role, u.created_at, u.disabled,
                  u.group_id, g.name AS group_name,
                  (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.username) AS session_count,
                  (SELECT MAX(s.local_date) FROM sessions s WHERE s.user_id = u.username) AS last_active,
                  (SELECT COUNT(*) FROM api_tokens t WHERE t.user_id = u.id AND t.revoked_at IS NULL) AS token_count
           FROM users u LEFT JOIN groups g ON g.id = u.group_id ORDER BY u.created_at`
        )
        .all()
      return (json(res, 200, { users }), true)
    }

    if (route === '/api/admin/users' && req.method === 'POST') {
      const body = await readJson(req)
      const username = String(body.username ?? '').trim()
      const password = String(body.password ?? '')
      if (!username || password.length < 8) {
        return (json(res, 400, { error: '需要 username，且密码至少 8 位' }), true)
      }
      if (findUserByUsername(db, username)) {
        return (json(res, 409, { error: '用户名已存在' }), true)
      }
      const groupId = body.groupId ?? null
      if (groupId !== null && !db.prepare('SELECT 1 FROM groups WHERE id = ?').get(groupId)) {
        return (json(res, 400, { error: '小组不存在' }), true)
      }
      const role = ['admin', 'lead', 'member'].includes(body.role) ? body.role : 'member'
      const user = createUser(db, {
        username,
        password,
        displayName: body.displayName ?? username,
        role,
        groupId
      })
      return (json(res, 201, { user }), true)
    }

    if (route.startsWith('/api/admin/users/') && req.method === 'PATCH') {
      const id = decodeURIComponent(route.slice('/api/admin/users/'.length))
      const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id)
      if (!target) {
        return (json(res, 404, { error: '用户不存在' }), true)
      }
      const body = await readJson(req)
      // Why: locking every admin out of the only admin account is unrecoverable
      // from the UI, so the last enabled admin cannot demote or disable itself.
      const adminsLeft = db
        .prepare(
          "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND id != ?"
        )
        .get(id).n
      const demoting = body.role === 'lead' || body.role === 'member' || body.disabled === true
      if (target.role === 'admin' && demoting && adminsLeft === 0) {
        return (json(res, 400, { error: '至少要保留一个启用中的管理员' }), true)
      }
      const user = updateUser(db, id, body)
      return (json(res, 200, { user }), true)
    }

    if (
      route.startsWith('/api/admin/users/') &&
      route.endsWith('/tokens') &&
      req.method === 'GET'
    ) {
      const id = decodeURIComponent(route.slice('/api/admin/users/'.length, -'/tokens'.length))
      return (json(res, 200, { tokens: listTokens(db, id) }), true)
    }

    if (route.startsWith('/api/admin/tokens/') && req.method === 'DELETE') {
      const id = decodeURIComponent(route.slice('/api/admin/tokens/'.length))
      return (json(res, 200, { revoked: revokeTokenAsAdmin(db, id) }), true)
    }
  }

  return (json(res, 404, { error: 'not found' }), true)
}
