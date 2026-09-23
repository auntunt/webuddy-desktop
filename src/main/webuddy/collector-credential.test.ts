import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { OrcaCloudAuthConfig } from '../orca-profiles/profile-cloud-auth-config'
import type { ActiveOrcaProfileState } from '../orca-profiles/profile-index-store'
import type { OrcaCloudSession } from '../orca-profiles/profile-cloud-session-store'
import {
  clearCollectorCredential,
  needsCollectorReissue,
  syncCollectorCredential,
  type SyncCollectorCredentialDeps
} from './collector-credential'
import { ensureCollectorDeviceId } from './collector-config'

const DAY = 86_400_000
const now = Date.UTC(2026, 8, 23)

describe('needsCollectorReissue', () => {
  const base = {
    now,
    config: {
      token: 'wb_x',
      userId: 'lina',
      tokenExpiresAt: now + 60 * DAY,
      tokenIssuedAt: now - DAY
    },
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
  it('keeps the token when the 401 predates it (stale authRejected)', () => {
    expect(
      needsCollectorReissue({
        ...base,
        lastPush: {
          at: new Date(now - 2 * DAY).toISOString(),
          pushed: 0,
          failed: 0,
          exhausted: 0,
          authRejected: true
        }
      })
    ).toBe(false)
  })
  it('reissues on authRejected when the token has no recorded issue time', () => {
    const { tokenIssuedAt: _drop, ...config } = base.config
    expect(
      needsCollectorReissue({
        ...base,
        config,
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
      JSON.stringify({
        token: 't',
        userId: 'u',
        tokenExpiresAt: 1,
        endpoint: 'https://cloud.example.test/api/ingest',
        deviceLabel: 'mac'
      })
    )
    await clearCollectorCredential(env)
    expect(JSON.parse(await readFile(join(home, 'config.json'), 'utf8'))).toEqual({
      deviceLabel: 'mac'
    })
  })
  it('clear deletes last-push.json so the next user does not see the prior status', async () => {
    const home = await mkdtemp(join(tmpdir(), 'wbc-'))
    const env = { WEBUDDY_AGENT_HOME: home }
    await writeFile(join(home, 'config.json'), JSON.stringify({ token: 't', userId: 'u' }))
    await writeFile(
      join(home, 'last-push.json'),
      JSON.stringify({ at: new Date().toISOString(), pushed: 1, failed: 0, exhausted: 0 })
    )
    await clearCollectorCredential(env)
    await expect(access(join(home, 'last-push.json'))).rejects.toThrow()
  })
  it('clear does not touch the file when there is nothing to remove', async () => {
    const home = await mkdtemp(join(tmpdir(), 'wbc-'))
    const env = { WEBUDDY_AGENT_HOME: home }
    await writeFile(join(home, 'config.json'), JSON.stringify({ deviceLabel: 'mac' }))
    const before = await readFile(join(home, 'config.json'), 'utf8')
    await clearCollectorCredential(env)
    expect(await readFile(join(home, 'config.json'), 'utf8')).toBe(before)
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

const fakeAuthConfig: OrcaCloudAuthConfig = {
  apiBaseUrl: 'https://cloud.example.test',
  sessionEndpoint: 'https://cloud.example.test/api/desktop/session',
  refreshEndpoint: 'https://cloud.example.test/api/desktop/refresh',
  capabilitiesEndpoint: 'https://cloud.example.test/api/desktop/capabilities',
  profileEndpoint: 'https://cloud.example.test/api/desktop/profile',
  orgEndpoint: 'https://cloud.example.test/api/desktop/org',
  logoutEndpoint: 'https://cloud.example.test/api/desktop/logout',
  relayTokenEndpoint: 'https://cloud.example.test/api/desktop/relay-token',
  relayDirectorUrl: 'https://cloud.example.test'
}

const fakeSession: OrcaCloudSession = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: now + DAY,
  capabilities: { flags: {}, refreshedAt: now }
}

function activeProfile(userId: string | undefined): ActiveOrcaProfileState {
  return {
    index: { schemaVersion: 1, activeProfileId: 'p1', profiles: [] },
    profile: {
      id: 'p1',
      name: 'Lina',
      avatar: { kind: 'initials', initials: 'L', color: 'neutral' },
      kind: userId ? 'cloud-linked' : 'local',
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      ...(userId
        ? {
            cloud: {
              cloudProfileId: 'cp1',
              userId,
              email: `${userId}@example.test`,
              linkedAt: now
            }
          }
        : {})
    },
    dataFile: 'orca-data.json',
    profileDirectory: 'profiles/p1'
  }
}

function baseDeps(
  overrides: Partial<SyncCollectorCredentialDeps> = {}
): SyncCollectorCredentialDeps {
  return {
    getOrcaCloudAuthConfig: () => ({ configured: true, config: fakeAuthConfig }),
    getProfileUserDataPath: () => 'user-data',
    ensureActiveOrcaProfile: () => activeProfile('lina'),
    runWithFreshOrcaCloudSession: async (_config, _active, _userDataPath, operation) => ({
      status: 'ok',
      value: await operation(fakeSession)
    }),
    requestCollectorToken: async () => ({
      token: 'wb_new',
      userId: 'lina',
      expiresAt: now + 60 * DAY
    }),
    ...overrides
  }
}

describe('syncCollectorCredential', () => {
  it('issues a fresh token and writes it to config.json', async () => {
    const home = await mkdtemp(join(tmpdir(), 'wbc-'))
    const env = { WEBUDDY_AGENT_HOME: home }
    const outcome = await syncCollectorCredential(env, baseDeps())
    expect(outcome).toBe('issued')
    const config = JSON.parse(await readFile(join(home, 'config.json'), 'utf8'))
    expect(config.token).toBe('wb_new')
    expect(config.userId).toBe('lina')
    expect(typeof config.tokenIssuedAt).toBe('number')
  })

  it('clears when the active profile has no cloud link', async () => {
    const home = await mkdtemp(join(tmpdir(), 'wbc-'))
    const env = { WEBUDDY_AGENT_HOME: home }
    await writeFile(
      join(home, 'config.json'),
      JSON.stringify({ token: 't', userId: 'lina', tokenExpiresAt: 1 })
    )
    const outcome = await syncCollectorCredential(
      env,
      baseDeps({ ensureActiveOrcaProfile: () => activeProfile(undefined) })
    )
    expect(outcome).toBe('cleared')
    const config = JSON.parse(await readFile(join(home, 'config.json'), 'utf8'))
    expect(config.token).toBeUndefined()
  })

  it('skips without writing when the server payload is malformed', async () => {
    const home = await mkdtemp(join(tmpdir(), 'wbc-'))
    const env = { WEBUDDY_AGENT_HOME: home }
    // Stands in for parseCollectorTokenResponse rejecting a malformed body
    // (the real requestCollectorToken throws the same way for a bad payload).
    const outcome = await syncCollectorCredential(
      env,
      baseDeps({
        requestCollectorToken: async () => {
          throw new Error('invalid_collector_token_response')
        }
      })
    )
    expect(outcome).toBe('skipped')
    await expect(readFile(join(home, 'config.json'), 'utf8')).rejects.toThrow()
  })

  it('does not resurrect a token cleared while the token request was in flight', async () => {
    const home = await mkdtemp(join(tmpdir(), 'wbc-'))
    const env = { WEBUDDY_AGENT_HOME: home }
    await writeFile(join(home, 'config.json'), JSON.stringify({ deviceLabel: 'mac' }))
    let resolveToken: (value: {
      token: string
      userId: string
      expiresAt: number
    }) => void = () => {}
    const deferred = new Promise<{ token: string; userId: string; expiresAt: number }>(
      (resolve) => {
        resolveToken = resolve
      }
    )
    // Signals once syncCollectorCredential has actually reached the network
    // call, which only happens after it has captured its start generation —
    // this pins the race instead of hoping real fs timing lines up.
    let requestStarted: () => void = () => {}
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve
    })
    const syncPromise = syncCollectorCredential(
      env,
      baseDeps({
        requestCollectorToken: async () => {
          requestStarted()
          return deferred
        }
      })
    )
    await started
    // Sign-out lands while the sync above is still awaiting the server.
    await clearCollectorCredential(env)
    resolveToken({ token: 'wb_new', userId: 'lina', expiresAt: now + 60 * DAY })
    const outcome = await syncPromise
    expect(outcome).toBe('skipped')
    const config = JSON.parse(await readFile(join(home, 'config.json'), 'utf8'))
    expect(config).toEqual({ deviceLabel: 'mac' })
  })

  it('two concurrent calls share one in-flight sync (single token request)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'wbc-'))
    const env = { WEBUDDY_AGENT_HOME: home }
    let requestCalls = 0
    const deps = baseDeps({
      requestCollectorToken: async () => {
        requestCalls += 1
        return { token: 'wb_new', userId: 'lina', expiresAt: now + 60 * DAY }
      }
    })
    const [a, b] = await Promise.all([
      syncCollectorCredential(env, deps),
      syncCollectorCredential(env, deps)
    ])
    expect(requestCalls).toBe(1)
    expect(a).toBe('issued')
    expect(b).toBe('issued')
  })
})
