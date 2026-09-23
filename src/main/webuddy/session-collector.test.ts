import { describe, expect, it } from 'vitest'
import { sessionCollectorEnv } from './session-collector'

describe('sessionCollectorEnv', () => {
  it('strips WEBUDDY_TOKEN and WEBUDDY_USER_ID so config.json cannot be overridden', () => {
    const env = sessionCollectorEnv({
      PATH: '/usr/bin',
      WEBUDDY_TOKEN: 'stale-token',
      WEBUDDY_USER_ID: 'stale-user'
    })
    expect(env.WEBUDDY_TOKEN).toBeUndefined()
    expect(env.WEBUDDY_USER_ID).toBeUndefined()
    expect(env.PATH).toBe('/usr/bin')
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it('passes WEBUDDY_ENDPOINT through only when explicitly set', () => {
    expect(sessionCollectorEnv({}).WEBUDDY_ENDPOINT).toBeUndefined()
    expect(sessionCollectorEnv({ WEBUDDY_ENDPOINT: 'https://x/api/ingest' }).WEBUDDY_ENDPOINT).toBe(
      'https://x/api/ingest'
    )
  })
})
