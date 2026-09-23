import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer } from './harness.mjs'

test('/api/health responds 200 without auth', async () => {
  const server = await startTestServer()
  try {
    const res = await server.api(null, '/api/health')
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
  } finally {
    await server.close()
  }
})

test('/api/sessions requires a token', async () => {
  const server = await startTestServer()
  try {
    const res = await server.api(null, '/api/sessions')
    assert.equal(res.status, 401)
  } finally {
    await server.close()
  }
})

test('login then /api/auth/me returns the logged-in user', async () => {
  const server = await startTestServer()
  try {
    server.createUser({ username: 'lina' })
    const token = await server.login('lina')
    const res = await server.api(token, '/api/auth/me')
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.user.username, 'lina')
  } finally {
    await server.close()
  }
})

test('ingest then /api/sessions finds the uploaded record', async () => {
  const server = await startTestServer()
  try {
    server.createUser({ username: 'lina' })
    const token = await server.login('lina')
    const ingestRes = await server.ingestSession(token)
    assert.equal(ingestRes.status, 200)
    const ingestBody = await ingestRes.json()
    assert.equal(ingestBody.written, 1)
    assert.equal(ingestBody.rejected.length, 0)

    const res = await server.api(token, '/api/sessions')
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.total, 1)
    assert.equal(body.items[0].user_id, 'lina')
  } finally {
    await server.close()
  }
})
