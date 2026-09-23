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
