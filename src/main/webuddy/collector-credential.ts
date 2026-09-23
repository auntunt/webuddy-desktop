/** Keeps ~/.webuddy-agent/config.json holding the signed-in person's upload token. */

import { ensureActiveOrcaProfile } from '../orca-profiles/profile-index-store'
import { getOrcaCloudAuthConfig } from '../orca-profiles/profile-cloud-auth-config'
import { OrcaCloudRequestError } from '../orca-profiles/profile-cloud-client'
import { runWithFreshOrcaCloudSession } from '../orca-profiles/profile-cloud-session-refresh'
import { getProfileUserDataPath } from '../orca-profiles/profile-storage-paths'
import {
  collectorConfigPath,
  ensureCollectorDeviceId,
  readCollectorConfig,
  readLastPush,
  writeCollectorConfig
} from './collector-config'
import { CREDENTIAL_KEYS, needsCollectorReissue } from './collector-credential-policy'

export { needsCollectorReissue } from './collector-credential-policy'

// Why a queue instead of a lock: clear and sync each do read-then-write against
// the same config.json. Without serializing them, an in-flight sync's write
// could land after a concurrent clear and resurrect a token that was just
// revoked, or two concurrent syncs could interleave their read-modify-write.
let credentialQueue: Promise<unknown> = Promise.resolve()
// Bumped by every clear. A sync that started before a clear checks this right
// before it writes, so it never resurrects a credential the clear just removed.
let credentialGeneration = 0

function enqueueCredentialOp<T>(op: () => Promise<T>): Promise<T> {
  const settled = credentialQueue.then(op, op)
  credentialQueue = settled.then(
    () => undefined,
    () => undefined
  )
  return settled
}

export async function clearCollectorCredential(
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  await enqueueCredentialOp(async () => {
    credentialGeneration += 1
    const path = collectorConfigPath(env)
    const config = await readCollectorConfig(path)
    if (!CREDENTIAL_KEYS.some((key) => key in config)) {
      return
    }
    for (const key of CREDENTIAL_KEYS) {
      delete config[key]
    }
    await writeCollectorConfig(path, config)
  })
}

type CollectorTokenResponse = { token: string; userId: string; expiresAt: number }

function parseCollectorTokenResponse(value: unknown): CollectorTokenResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('invalid_collector_token_response')
  }
  const record: Record<string, unknown> = { ...value }
  if (
    typeof record.token !== 'string' ||
    !record.token ||
    typeof record.userId !== 'string' ||
    !record.userId ||
    typeof record.expiresAt !== 'number' ||
    !Number.isFinite(record.expiresAt)
  ) {
    throw new Error('invalid_collector_token_response')
  }
  return { token: record.token, userId: record.userId, expiresAt: record.expiresAt }
}

async function requestCollectorToken(
  apiBaseUrl: string,
  deviceId: string,
  accessToken: string
): Promise<CollectorTokenResponse> {
  const response = await fetch(new URL('/api/desktop/collector-token', `${apiBaseUrl}/`), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ deviceId })
  })
  if (!response.ok) {
    throw new OrcaCloudRequestError(response.status)
  }
  return parseCollectorTokenResponse(await response.json())
}

/** Test seam: every external dependency syncCollectorCredential reaches out to. */
export type SyncCollectorCredentialDeps = {
  getOrcaCloudAuthConfig: typeof getOrcaCloudAuthConfig
  getProfileUserDataPath: typeof getProfileUserDataPath
  ensureActiveOrcaProfile: typeof ensureActiveOrcaProfile
  runWithFreshOrcaCloudSession: typeof runWithFreshOrcaCloudSession
  requestCollectorToken: typeof requestCollectorToken
}

const defaultSyncDeps: SyncCollectorCredentialDeps = {
  getOrcaCloudAuthConfig,
  getProfileUserDataPath,
  ensureActiveOrcaProfile,
  runWithFreshOrcaCloudSession,
  requestCollectorToken
}

/**
 * Keeps ~/.webuddy-agent/config.json holding the signed-in person's upload
 * token. Never throws: collection must not break the app.
 */
export async function syncCollectorCredential(
  env: NodeJS.ProcessEnv = process.env,
  deps: SyncCollectorCredentialDeps = defaultSyncDeps
): Promise<'issued' | 'unchanged' | 'cleared' | 'skipped'> {
  try {
    const configState = deps.getOrcaCloudAuthConfig()
    if (!configState.configured) {
      return 'skipped'
    }
    const userDataPath = deps.getProfileUserDataPath()
    const active = deps.ensureActiveOrcaProfile(userDataPath)
    const cloud = active.profile.cloud
    if (!cloud) {
      await clearCollectorCredential(env)
      return 'cleared'
    }
    const path = collectorConfigPath(env)
    const config = await readCollectorConfig(path)
    const lastPush = await readLastPush(env)
    if (
      !needsCollectorReissue({ now: Date.now(), config, signedInUserId: cloud.userId, lastPush })
    ) {
      return 'unchanged'
    }
    // Why captured before the network round trip: a clear that lands while we
    // are awaiting the server must stop us from writing a token it just revoked.
    const startGeneration = credentialGeneration
    const deviceId = await ensureCollectorDeviceId(env)
    const apiBaseUrl = configState.config.apiBaseUrl
    const result = await deps.runWithFreshOrcaCloudSession(
      configState.config,
      active,
      userDataPath,
      (session) => deps.requestCollectorToken(apiBaseUrl, deviceId, session.accessToken)
    )
    if (result.status !== 'ok') {
      await clearCollectorCredential(env)
      return 'cleared'
    }
    return await enqueueCredentialOp(async () => {
      const stillSignedIn = deps.ensureActiveOrcaProfile(userDataPath).profile.cloud?.userId
      if (startGeneration !== credentialGeneration || stillSignedIn !== result.value.userId) {
        return 'skipped' as const
      }
      const fresh = await readCollectorConfig(path)
      await writeCollectorConfig(path, {
        ...fresh,
        endpoint: new URL('/api/ingest', `${apiBaseUrl}/`).toString(),
        token: result.value.token,
        userId: result.value.userId,
        tokenExpiresAt: result.value.expiresAt,
        tokenIssuedAt: Date.now()
      })
      return 'issued' as const
    })
  } catch (error) {
    console.warn(
      '[webuddy] collector credential sync failed:',
      error instanceof Error ? error.message : String(error)
    )
    return 'skipped'
  }
}
