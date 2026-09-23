import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readCollectorStatus } from './collector-status'

describe('readCollectorStatus', () => {
  it('reports linked status, last push, and pending outbox count', async () => {
    const home = await mkdtemp(join(tmpdir(), 'wbs-'))
    const env = { WEBUDDY_AGENT_HOME: home }
    await writeFile(
      join(home, 'config.json'),
      JSON.stringify({ token: 'wb_x', userId: 'lina', tokenExpiresAt: Date.now() + 1000 })
    )
    await writeFile(
      join(home, 'last-push.json'),
      JSON.stringify({
        at: '2026-09-23T00:00:00.000Z',
        pushed: 3,
        failed: 1,
        exhausted: 0,
        authRejected: false
      })
    )
    await mkdir(join(home, 'outbox'), { recursive: true })
    await writeFile(join(home, 'outbox', 'a.json'), '{}')
    await writeFile(join(home, 'outbox', 'b.json'), '{}')
    await writeFile(join(home, 'outbox', 'c.tmp'), '{}')

    const status = await readCollectorStatus(env)

    expect(status.linked).toBe(true)
    expect(status.userId).toBe('lina')
    expect(status.pending).toBe(2)
    expect(status.lastPush).toEqual({
      at: '2026-09-23T00:00:00.000Z',
      pushed: 3,
      failed: 1,
      authRejected: false
    })
  })

  it('reports the unlinked/empty state for an unused home', async () => {
    const home = await mkdtemp(join(tmpdir(), 'wbs-'))
    const env = { WEBUDDY_AGENT_HOME: home }

    expect(await readCollectorStatus(env)).toEqual({
      linked: false,
      userId: null,
      lastPush: null,
      pending: 0
    })
  })
})
