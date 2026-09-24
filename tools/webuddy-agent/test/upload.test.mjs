import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'wba-'))
process.env.WEBUDDY_AGENT_HOME = home
const { pushPending } = await import('../lib/upload.mjs')
const { paths } = await import('../lib/state.mjs')

function queue(n) {
  rmSync(paths.outbox, { recursive: true, force: true })
  mkdirSync(paths.outbox, { recursive: true })
  for (let i = 0; i < n; i++) {
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
  assert.equal(readdirSync(paths.outbox).filter((f) => f.endsWith('.attempts')).length, 0)
})

test('no token skips the push without calling fetch', async () => {
  queue(2)
  let calls = 0
  const result = await pushPending({
    endpoint: 'http://x/api/ingest',
    token: '',
    deviceId: 'd',
    fetchImpl: async () => {
      calls += 1
      return new Response('{}', { status: 200 })
    }
  })
  assert.equal(calls, 0)
  assert.deepEqual(result, {
    pushed: 0,
    failed: 0,
    exhausted: 0,
    skipped: 'no token',
    authRejected: false
  })
  assert.equal(readdirSync(paths.outbox).filter((f) => f.endsWith('.json')).length, 2)
})

test('successful push reports authRejected: false', async () => {
  queue(2)
  const result = await pushPending({
    endpoint: 'http://x/api/ingest',
    token: 't',
    deviceId: 'd',
    fetchImpl: async () => new Response('{}', { status: 200 })
  })
  assert.equal(result.authRejected, false)
  assert.equal(result.pushed, 2)
  assert.equal(readdirSync(paths.outbox).filter((f) => f.endsWith('.json')).length, 0)
})

test('batch payload carries conversation when the outbox entry has one', async () => {
  const { enqueue } = await import('../lib/upload.mjs')
  rmSync(paths.outbox, { recursive: true, force: true })
  const record = { agent: { id: 'a' }, session: { id: 's' } }
  await enqueue(record, 'body', [{ role: 'user', text: 'hi', timestamp: null }])
  await enqueue({ ...record, session: { id: 't' } }, 'body')
  let body = null
  await pushPending({
    endpoint: 'http://x/api/ingest',
    token: 't',
    deviceId: 'd',
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body)
      return new Response('{}', { status: 200 })
    }
  })
  const withConversation = body.records.filter((r) => 'conversation' in r)
  assert.equal(withConversation.length, 1)
  assert.deepEqual(withConversation[0].conversation, [
    { role: 'user', text: 'hi', timestamp: null }
  ])
})

test('same-session records enqueued in the same millisecond do not overwrite each other', async (t) => {
  const { enqueue } = await import('../lib/upload.mjs')
  rmSync(paths.outbox, { recursive: true, force: true })
  t.mock.method(Date, 'now', () => 1_700_000_000_000)
  const record = { agent: { id: 'claude-code' }, session: { id: 'parent' } }
  const first = await enqueue(record, 'parent body')
  const second = await enqueue(record, 'subagent body')
  assert.notEqual(first, second)
  assert.equal(readdirSync(paths.outbox).filter((f) => f.endsWith('.json')).length, 2)
})
