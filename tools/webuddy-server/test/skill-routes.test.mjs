import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { startTestServer } from './harness.mjs'
import { recordSkillRun } from '../lib/skill-runs.mjs'

describe('GET /api/skills', () => {
  let t
  let token
  before(async () => {
    t = await startTestServer()
    t.createUser({ username: 'lina' })
    token = await t.login('lina')
  })
  after(() => t.close())

  it('reports lastRun as null before any extraction', async () => {
    const body = await (await t.api(token, '/api/skills')).json()
    assert.equal(body.lastRun, null)
    assert.deepEqual(body.items, [])
  })

  it('exposes the latest skill run so the dashboard can say why nothing was extracted', async () => {
    recordSkillRun(t.db, {
      userId: 'lina',
      startedAt: '2026-09-20T00:00:00Z',
      finishedAt: '2026-09-20T00:01:00Z',
      status: 'empty',
      extracted: 0
    })
    recordSkillRun(t.db, {
      userId: 'lina',
      startedAt: '2026-09-21T00:00:00Z',
      finishedAt: '2026-09-21T00:10:00Z',
      status: 'error',
      extracted: 0,
      error: 'timeout'
    })
    const body = await (await t.api(token, '/api/skills')).json()
    assert.deepEqual(body.lastRun, {
      status: 'error',
      finishedAt: '2026-09-21T00:10:00Z',
      extracted: 0,
      error: 'timeout'
    })
  })
})
