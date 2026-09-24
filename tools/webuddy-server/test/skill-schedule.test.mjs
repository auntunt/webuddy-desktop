import { afterEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

import { startSkillSchedule } from '../lib/skill-schedule.mjs'
import { LLM_ENV, fakeReply, insertSession, openTempDb } from './skill-fixtures.mjs'

let db
let schedule
afterEach(() => {
  schedule?.stop()
  mock.restoreAll()
  db?.close()
})

function captureLogs() {
  const lines = []
  mock.method(console, 'log', (...args) => lines.push(args.join(' ')))
  mock.method(console, 'error', (...args) => lines.push(args.join(' ')))
  return lines
}

describe('startSkillSchedule', () => {
  it('logs every outcome: result status, skips and failures', async () => {
    db = openTempDb()
    insertSession(db, { user: 'lina', receivedAt: '2026-09-20T01:00:00Z' })
    const lines = captureLogs()
    fakeReply('garbage')
    schedule = startSkillSchedule(db, { env: LLM_ENV })
    await schedule.tick()
    await schedule.tick()
    mock.method(globalThis, 'fetch', async () => {
      throw new Error('boom')
    })
    insertSession(db, { user: 'lina', receivedAt: '2026-09-21T01:00:00Z' })
    await schedule.tick()
    assert.match(lines[0], /\[skills\] lina: parse-failed \+0/)
    assert.match(lines[1], /\[skills\] lina skipped \(no-new-data\)/)
    assert.match(lines[2], /\[skills\] lina failed: .*boom/)
  })

  it('runs once shortly after startup, not only on the interval', async () => {
    db = openTempDb()
    insertSession(db, { user: 'lina', receivedAt: '2026-09-20T01:00:00Z' })
    const lines = captureLogs()
    schedule = startSkillSchedule(db, { env: { WEBUDDY_SKILL_STARTUP_MS: '5' } })
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.match(lines.join('\n'), /\[skills\] lina skipped \(no-api-key\)/)
  })
})
