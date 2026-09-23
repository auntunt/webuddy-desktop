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
  writeCollectorConfig,
  type LastPush
} from './collector-config'

const RENEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const CREDENTIAL_KEYS = ['token', 'userId', 'tokenExpiresAt'] as const

export function needsCollectorReissue(input: {
  now: number
  config: Record<string, unknown>
  signedInUserId: string
  lastPush: LastPush | null
}): boolean {
  const { config } = input
  if (typeof config.token !== 'string' || !config.token) {
    return true
  }
  if (config.userId !== input.signedInUserId) {
    return true
  }
  if (
    typeof config.tokenExpiresAt !== 'number' ||
    config.tokenExpiresAt - input.now < RENEW_WINDOW_MS
  ) {
    return true
  }
  return input.lastPush?.authRejected === true
}

export async function clearCollectorCredential(
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const path = collectorConfigPath(env)
  const config = await readCollectorConfig(path)
  for (const key of CREDENTIAL_KEYS) {
    delete config[key]
  }
  await writeCollectorConfig(path, config)
}

type CollectorTokenResponse = { token: string; userId: string; expiresAt: number }

function parseCollectorTokenResponse(value: unknown): CollectorTokenResponse {
  if (!value || typeof value !== 'object') {
    throw new Error('invalid_collector_token_response')
  }
  const record = value as Record<string, unknown>
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

/**
 * Keeps ~/.webuddy-agent/config.json holding the signed-in person's upload
 * token. Never throws: collection must not break the app.
 */
export async function syncCollectorCredential(
  env: NodeJS.ProcessEnv = process.env
): Promise<'issued' | 'unchanged' | 'cleared' | 'skipped'> {
  try {
    const configState = getOrcaCloudAuthConfig()
    if (!configState.configured) {
      return 'skipped'
    }
    const userDataPath = getProfileUserDataPath()
    const active = ensureActiveOrcaProfile(userDataPath)
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
    const deviceId = await ensureCollectorDeviceId(env)
    const apiBaseUrl = configState.config.apiBaseUrl
    const result = await runWithFreshOrcaCloudSession(
      configState.config,
      active,
      userDataPath,
      (session) => requestCollectorToken(apiBaseUrl, deviceId, session.accessToken)
    )
    if (result.status !== 'ok') {
      await clearCollectorCredential(env)
      return 'cleared'
    }
    await writeCollectorConfig(path, {
      ...config,
      endpoint: new URL('/api/ingest', `${apiBaseUrl}/`).toString(),
      token: result.value.token,
      userId: result.value.userId,
      tokenExpiresAt: result.value.expiresAt
    })
    return 'issued'
  } catch (error) {
    console.warn(
      '[webuddy] collector credential sync failed:',
      error instanceof Error ? error.message : String(error)
    )
    return 'skipped'
  }
}
