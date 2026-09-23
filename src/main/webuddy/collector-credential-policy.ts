/** Pure reissue policy for the collector credential, split out to keep collector-credential.ts small. */

import type { LastPush } from './collector-config'

/** How long before a token's expiry we proactively reissue it. */
export const RENEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

/** Config keys that hold credential state; cleared together on sign-out. */
export const CREDENTIAL_KEYS = [
  'token',
  'userId',
  'tokenExpiresAt',
  'tokenIssuedAt',
  'endpoint'
] as const

export function needsCollectorReissue(input: {
  now: number
  config: Record<string, unknown>
  signedInUserId: string
  lastPush: LastPush | null
}): boolean {
  const { config, lastPush } = input
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
  if (!lastPush?.authRejected) {
    return false
  }
  // Why compare timestamps, not just the flag: a 401 reported against an
  // earlier token must not force reissue of a token that has since replaced it.
  const issuedAt = typeof config.tokenIssuedAt === 'number' ? config.tokenIssuedAt : null
  const rejectedAt = Date.parse(lastPush.at)
  if (issuedAt === null || Number.isNaN(rejectedAt)) {
    return true
  }
  return rejectedAt > issuedAt
}
