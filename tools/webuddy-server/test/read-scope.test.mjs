import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer } from './harness.mjs'

let server
const tokens = {}
const keys = {}

async function seed() {
  server = await startTestServer()
  const { db } = server
  const now = new Date().toISOString()
  db.prepare('INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)').run('gA', 'A', now)
  db.prepare('INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)').run('gB', 'B', now)
  const layout = [
    ['lead1', 'lead', 'gA'],
    ['a1', 'member', 'gA'],
    ['b1', 'member', 'gB'],
    ['root', 'admin', null]
  ]
  for (const [username, role, groupId] of layout) {
    const user = server.createUser({ username, role })
    db.prepare('UPDATE users SET group_id = ? WHERE id = ?').run(groupId, user.id)
    tokens[username] = await server.login(username)
  }
  for (const username of ['lead1', 'a1', 'b1']) {
    const res = await server.ingestSession(tokens[username], {
      actor: {
        userId: 'x',
        deviceId: `dev-${username}`,
        hostname: 'h',
        osUser: 'o',
        platform: 'darwin'
      }
    })
    assert.equal(res.status, 200)
    keys[username] = db
      .prepare('SELECT dedupe_key FROM sessions WHERE user_id = ?')
      .get(username).dedupe_key
  }
}

async function getJson(who, path) {
  const res = await server.api(tokens[who], path)
  return { status: res.status, body: res.status === 200 ? await res.json() : null }
}

const usersOf = (items) => items.map((s) => s.user_id).sort()

before(seed)
after(() => server.close())

test('lead sees only their group', async () => {
  assert.deepEqual(usersOf((await getJson('lead1', '/api/sessions')).body.items), ['a1', 'lead1'])
  assert.deepEqual((await getJson('lead1', '/api/sessions?user=b1')).body.items, [])
  assert.equal((await getJson('lead1', `/api/sessions/${encodeURIComponent(keys.b1)}`)).status, 404)
  assert.equal((await getJson('lead1', `/api/sessions/${encodeURIComponent(keys.a1)}`)).status, 200)
  const people = (await getJson('lead1', '/api/facets')).body.people.map((p) => p.value)
  assert.ok(!people.includes('b1'))
  assert.equal((await getJson('lead1', '/api/export.json')).body.items.length, 2)
  // group filter cannot widen a lead's scope
  assert.deepEqual((await getJson('lead1', '/api/sessions?group=gB')).body.items, [])
})

test('member sees only themselves', async () => {
  assert.deepEqual(usersOf((await getJson('a1', '/api/sessions')).body.items), ['a1'])
  assert.deepEqual((await getJson('a1', '/api/sessions?user=lead1')).body.items, [])
  assert.equal((await getJson('a1', '/api/insights?user=lead1')).body.overall.sessions, 0)
})

test('admin sees everyone and can filter by group', async () => {
  assert.equal((await getJson('root', '/api/sessions')).body.items.length, 3)
  assert.deepEqual(usersOf((await getJson('root', '/api/sessions?group=gA')).body.items), [
    'a1',
    'lead1'
  ])
})

test('insights and stats respect scope', async () => {
  assert.equal((await getJson('lead1', '/api/insights')).body.overall.sessions, 2)
  assert.equal((await getJson('lead1', '/api/insights?user=__all__')).body.overall.sessions, 2)
  assert.equal((await getJson('lead1', '/api/insights?user=b1')).body.overall.sessions, 0)
  assert.equal((await getJson('lead1', '/api/stats')).body.totals.sessions, 2)
})

test('analysis rollups respect scope', async () => {
  const users = new Set(
    (await getJson('lead1', '/api/analysis')).body.rollups.map((r) => r.user_id)
  )
  assert.deepEqual([...users].sort(), ['a1', 'lead1'])
})

test('skills and llm analysis owner checks', async () => {
  assert.equal((await getJson('lead1', '/api/skills?user=b1')).status, 404)
  assert.equal((await getJson('lead1', '/api/skills?user=a1')).status, 200)
  assert.equal((await getJson('lead1', '/api/skills/bundle?user=b1')).status, 404)
  assert.equal((await getJson('root', '/api/skills?user=b1')).status, 200)
  assert.equal((await getJson('lead1', '/api/analysis/llm?user=__all__')).status, 404)
  assert.equal((await getJson('lead1', '/api/analysis/llm?user=b1')).status, 404)
  assert.equal((await getJson('lead1', '/api/analysis/llm?user=a1')).status, 200)
  assert.equal((await getJson('root', '/api/analysis/llm?user=__all__')).status, 200)
  const run = await server.api(tokens.lead1, '/api/analysis/llm/run?user=b1', { method: 'POST' })
  assert.equal(run.status, 404)
  const extract = await server.api(tokens.a1, '/api/skills/extract?user=lead1', { method: 'POST' })
  assert.equal(extract.status, 404)
})

test('skill download is scoped', async () => {
  const insert = server.db.prepare(
    "INSERT INTO skills (user_id, title, body, created_at) VALUES (?, 't', 'b', '2026-01-01')"
  )
  const b1Skill = insert.run('b1').lastInsertRowid
  const a1Skill = insert.run('a1').lastInsertRowid
  assert.equal((await getJson('lead1', `/api/skills/${b1Skill}/download`)).status, 404)
  const ok = await server.api(tokens.lead1, `/api/skills/${a1Skill}/download`)
  assert.equal(ok.status, 200)
  assert.equal((await server.api(tokens.root, `/api/skills/${b1Skill}/download`)).status, 200)
})
