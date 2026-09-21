/**
 * Users, credentials and API tokens.
 *
 * Why we hash with scrypt and store only token digests: the server holds every
 * developer's session transcripts, so a database leak must not hand over
 * working credentials. Passwords and tokens are both stored as one-way digests
 * with a per-record salt; the plaintext exists only in the response to the
 * login that created it.
 *
 * Roles: `admin` sees and manages every user's data; `member` only their own.
 */

import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto'

const KEYLEN = 64
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 }

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const digest = scryptSync(password, salt, KEYLEN, SCRYPT_PARAMS).toString('hex')
  return `scrypt$${salt}$${digest}`
}

export function verifyPassword(password, stored) {
  const [scheme, salt, digest] = String(stored ?? '').split('$')
  if (scheme !== 'scrypt' || !salt || !digest) {
    return false
  }
  const candidate = scryptSync(password, salt, KEYLEN, SCRYPT_PARAMS)
  const expected = Buffer.from(digest, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

/** Opaque bearer token handed to a client; only its digest is persisted. */
export function issueToken() {
  const token = `wb_${randomBytes(32).toString('base64url')}`
  return { token, digest: tokenDigest(token) }
}

export function tokenDigest(token) {
  return createHash('sha256').update(String(token)).digest('hex')
}

export const PUBLIC_USER_COLUMNS = 'id, username, display_name, role, created_at, disabled'

export function createUser(db, { username, password, displayName, role = 'member' }) {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO users (id, username, display_name, role, password_hash, created_at, disabled)
     VALUES (?, ?, ?, ?, ?, ?, 0)`
  ).run(
    id,
    username,
    displayName ?? username,
    role,
    hashPassword(password),
    new Date().toISOString()
  )
  return findUserById(db, id)
}

export function findUserById(db, id) {
  return db.prepare(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ?`).get(id) ?? null
}

export function findUserByUsername(db, username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) ?? null
}

export function listUsers(db) {
  return db.prepare(`SELECT ${PUBLIC_USER_COLUMNS} FROM users ORDER BY created_at`).all()
}

export function storeToken(db, { userId, label, digest, expiresAt = null }) {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO api_tokens (id, user_id, label, token_digest, created_at, expires_at, last_used_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`
  ).run(id, userId, label ?? null, digest, new Date().toISOString(), expiresAt)
  return id
}

/** Resolve a bearer token to its owner, or null when unknown/revoked/expired. */
export function resolveToken(db, token) {
  if (!token) {
    return null
  }
  const row = db
    .prepare('SELECT * FROM api_tokens WHERE token_digest = ? AND revoked_at IS NULL')
    .get(tokenDigest(token))
  if (!row) {
    return null
  }
  if (row.expires_at && Date.parse(row.expires_at) < Date.now()) {
    return null
  }
  db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    row.id
  )
  const user = findUserById(db, row.user_id)
  if (!user || user.disabled) {
    return null
  }
  return { user, tokenId: row.id }
}

export function revokeToken(db, tokenId, userId) {
  const result = db
    .prepare(
      'UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL'
    )
    .run(new Date().toISOString(), tokenId, userId)
  return result.changes > 0
}

/** Admin-side revoke: any token, not just your own. */
export function revokeTokenAsAdmin(db, tokenId) {
  const result = db
    .prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
    .run(new Date().toISOString(), tokenId)
  return result.changes > 0
}

/**
 * Partial update. Send only what changed.
 *
 * Why `disabled` and not delete: session rows reference the username, and
 * deleting the account would orphan a developer's whole history.
 */
export function updateUser(db, id, { role, disabled, displayName, password } = {}) {
  const fields = []
  const params = []
  if (role === 'admin' || role === 'member') {
    fields.push('role = ?')
    params.push(role)
  }
  if (typeof disabled === 'boolean') {
    fields.push('disabled = ?')
    params.push(disabled ? 1 : 0)
  }
  if (typeof displayName === 'string') {
    fields.push('display_name = ?')
    params.push(displayName)
  }
  if (typeof password === 'string' && password.length >= 8) {
    fields.push('password_hash = ?')
    params.push(hashPassword(password))
  }
  if (fields.length === 0) {
    return findUserById(db, id)
  }
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params, id)
  // Why revoke on password change/disable: otherwise a stolen token outlives the
  // reset that was meant to contain it.
  if (disabled === true || typeof password === 'string') {
    db.prepare('UPDATE api_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(
      new Date().toISOString(),
      id
    )
  }
  return findUserById(db, id)
}

export function listTokens(db, userId) {
  return db
    .prepare(
      'SELECT id, label, created_at, expires_at, last_used_at FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC'
    )
    .all(userId)
}

/**
 * First-boot admin. Without this the deployment has no way in, and creating a
 * user requires being a user.
 */
export function ensureBootstrapAdmin(db, { username, password }) {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM users').get().n
  if (existing > 0 || !username || !password) {
    return null
  }
  return createUser(db, { username, password, displayName: username, role: 'admin' })
}
