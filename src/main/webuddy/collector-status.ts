/** Read-only snapshot of the collector's link state for the settings pane. */

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { WebuddyCollectorStatus } from '../../shared/webuddy-collector'
import {
  collectorConfigPath,
  collectorStateDir,
  readCollectorConfig,
  readLastPush
} from './collector-config'

export async function readCollectorStatus(
  env: NodeJS.ProcessEnv = process.env
): Promise<WebuddyCollectorStatus> {
  const config = await readCollectorConfig(collectorConfigPath(env))
  const userId = typeof config.userId === 'string' ? config.userId : null
  const linked = typeof config.token === 'string' && !!config.token && userId !== null
  const lastPush = await readLastPush(env)
  let pending = 0
  try {
    const entries = await readdir(join(collectorStateDir(env), 'outbox'))
    pending = entries.filter((name) => name.endsWith('.json')).length
  } catch {
    // Why: no outbox yet means nothing pending, not an error.
    pending = 0
  }
  return {
    linked,
    userId,
    lastPush: lastPush
      ? {
          at: lastPush.at,
          pushed: lastPush.pushed,
          failed: lastPush.failed,
          authRejected: lastPush.authRejected,
          ...(lastPush.error !== undefined ? { error: lastPush.error } : {})
        }
      : null,
    pending
  }
}
