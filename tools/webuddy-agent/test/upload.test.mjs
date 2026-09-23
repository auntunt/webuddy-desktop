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
