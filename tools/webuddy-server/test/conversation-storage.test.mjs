import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { startTestServer } from './harness.mjs'

function sampleConversation() {
  return [
    { role: 'user', text: 'hi', timestamp: '2026-01-01T00:00:00.000Z' },
    { role: 'assistant', text: 'hello', timestamp: '2026-01-01T00:00:01.000Z' }
  ]
}

// baseRecord() only shallow-merges overrides, so a `session` override must
// carry every field the default record has, not just the one being changed.
function sessionOverride(id) {
  const now = new Date().toISOString()
  return {
    session: {
      id,
      startedAt: now,
      endedAt: now,
      durationMs: 1000,
      localDate: now.slice(0, 10),
      turnCount: 1,
      messageCount: 2,
      tokens: { input: 10, output: 20, total: 30 }
    }
  }
}

test('old-format payload with no conversation is still accepted', async () => {
  const server = await startTestServer()
  try {
    server.createUser({ username: 'lina' })
    const token = await server.login('lina')
    const res = await server.ingestSession(token)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.written, 1)
    assert.equal(body.rejected.length, 0)
  } finally {
    await server.close()
  }
})

test('new payload stores conversation and getSession returns it parsed', async () => {
  const server = await startTestServer()
  try {
    server.createUser({ username: 'lina' })
    const token = await server.login('lina')
    const sessionId = randomUUID()
    const res = await server.ingestSession(token, sessionOverride(sessionId), {
      conversation: sampleConversation()
    })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).written, 1)

    const list = await (await server.api(token, '/api/sessions')).json()
    const key = list.items[0].dedupe_key
    const detail = await (
      await server.api(token, `/api/sessions/${encodeURIComponent(key)}`)
    ).json()
    assert.deepEqual(detail.conversation, sampleConversation())
    assert.equal(detail.conversation_truncated, false)
  } finally {
    await server.close()
  }
})

test('a resend without conversation keeps the previously stored one', async () => {
  const server = await startTestServer()
  try {
    server.createUser({ username: 'lina' })
    const token = await server.login('lina')
    const sessionId = randomUUID()
    await server.ingestSession(token, sessionOverride(sessionId), {
      conversation: sampleConversation()
    })
    // Resend of the same session, older collector that sends no conversation.
    const resend = await server.ingestSession(token, sessionOverride(sessionId))
    assert.equal((await resend.json()).written, 1)

    const list = await (await server.api(token, '/api/sessions')).json()
    assert.equal(list.total, 1)
    const key = list.items[0].dedupe_key
    const detail = await (
      await server.api(token, `/api/sessions/${encodeURIComponent(key)}`)
    ).json()
    assert.deepEqual(detail.conversation, sampleConversation())
  } finally {
    await server.close()
  }
})

test('an oversized conversation is dropped but the record is still accepted', async () => {
  const server = await startTestServer()
  try {
    server.createUser({ username: 'lina' })
    const token = await server.login('lina')
    const huge = Array.from({ length: 20000 }, (_, i) => ({
      role: 'user',
      text: `line ${i} `.repeat(20),
      timestamp: null
    }))
    const res = await server.ingestSession(token, {}, { conversation: huge })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).written, 1)

    const list = await (await server.api(token, '/api/sessions')).json()
    const key = list.items[0].dedupe_key
    const detail = await (
      await server.api(token, `/api/sessions/${encodeURIComponent(key)}`)
    ).json()
    assert.equal(detail.conversation, null)
  } finally {
    await server.close()
  }
})

test('list endpoint never includes the conversation payload', async () => {
  const server = await startTestServer()
  try {
    server.createUser({ username: 'lina' })
    const token = await server.login('lina')
    await server.ingestSession(token, {}, { conversation: sampleConversation() })

    const list = await (await server.api(token, '/api/sessions')).json()
    assert.equal('conversation' in list.items[0], false)
    assert.equal('conversation_json' in list.items[0], false)

    const exportJson = await (await server.api(token, '/api/export.json')).json()
    assert.equal('conversation' in exportJson.items[0], false)
  } finally {
    await server.close()
  }
})
