import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clearCollectorCredential, needsCollectorReissue } from './collector-credential'
import { ensureCollectorDeviceId } from './collector-config'

const DAY = 86_400_000
const now = Date.UTC(2026, 8, 23)

describe('needsCollectorReissue', () => {
  const base = {
    now,
    config: { token: 'wb_x', userId: 'lina', tokenExpiresAt: now + 60 * DAY },
    signedInUserId: 'lina',
    lastPush: null
  }
  it('keeps a healthy token', () => {
    expect(needsCollectorReissue(base)).toBe(false)
  })
  it('reissues when missing', () => {
    expect(needsCollectorReissue({ ...base, config: {} })).toBe(true)
  })
  it('reissues when another person signed in', () => {
    expect(needsCollectorReissue({ ...base, signedInUserId: 'bo' })).toBe(true)
  })
  it('reissues inside the 30-day window', () => {
    expect(
      needsCollectorReissue({ ...base, config: { ...base.config, tokenExpiresAt: now + 29 * DAY } })
    ).toBe(true)
  })
  it('reissues after the collector reported 401 with this token', () => {
    expect(
      needsCollectorReissue({
        ...base,
        lastPush: {
          at: new Date(now).toISOString(),
          pushed: 0,
          failed: 0,
          exhausted: 0,
          authRejected: true
        }
      })
    ).toBe(true)
  })
})

describe('collector config files', () => {
  it('clear removes credentials but keeps other settings', async () => {
    const home = await mkdtemp(join(tmpdir(), 'wbc-'))
    const env = { WEBUDDY_AGENT_HOME: home }
    await writeFile(
      join(home, 'config.json'),
      JSON.stringify({ token: 't', userId: 'u', tokenExpiresAt: 1, deviceLabel: 'mac' })
    )
    await clearCollectorCredential(env)
    expect(JSON.parse(await readFile(join(home, 'config.json'), 'utf8'))).toEqual({
      deviceLabel: 'mac'
    })
  })
  it('device id is created once and reused (same file the collector uses)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'wbc-'))
    const env = { WEBUDDY_AGENT_HOME: home }
    const a = await ensureCollectorDeviceId(env)
    const b = await ensureCollectorDeviceId(env)
    expect(a).toBe(b)
    expect(JSON.parse(await readFile(join(home, 'device.json'), 'utf8')).deviceId).toBe(a)
  })
})
