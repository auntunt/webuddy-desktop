/**
 * Session collection, run by Webuddy itself.
 *
 * Why it lives in the app instead of a separate CLI: these records are team
 * management data, and a collector that needs someone to install a cron job is
 * a collector that quietly stops. Launching Webuddy is the one action every
 * developer already takes, so that is when collection runs.
 *
 * The collector itself stays a standalone dependency-free Node program (shared
 * with the server tooling); this module only schedules it and hands it config.
 */

import { join } from 'node:path'
import { runProcess } from '../../shared/child-process/run-process'
import { collectorConfigPath, readCollectorConfig } from './collector-config'
import { exportVaultSessions, type VaultSessionExportResult } from './vault-session-export'
import { productionVaultSessionExportDeps } from './vault-session-export-sources'

const FIRST_RUN_DELAY_MS = 45_000
const INTERVAL_MS = 30 * 60 * 1000
const STEP_TIMEOUT_MS = 20 * 60 * 1000

let timer: ReturnType<typeof setInterval> | null = null
let inFlight = false

/** Packaged location of the bundled collector. */
export function sessionCollectorEntryPath(resourcesPath: string): string {
  return join(resourcesPath, 'webuddy-agent', 'index.mjs')
}

/**
 * Env for the collector. Only non-secret defaults are injected here.
 *
 * Why no default endpoint: both the endpoint and the token are written into
 * the collector's config.json by `collector-credential.ts`, which runs before
 * each collection pass. A machine whose owner never signed in simply has no
 * endpoint or token there, and does not upload.
 *
 * Why WEBUDDY_TOKEN / WEBUDDY_USER_ID are stripped: the collector's env
 * overrides config.json, so a stale value inherited from the launching
 * process would keep uploading under the previous identity after sign-out.
 */
export function sessionCollectorEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const { WEBUDDY_TOKEN: _token, WEBUDDY_USER_ID: _userId, ...rest } = base
  return {
    ...rest,
    // Why: the forked Electron binary must behave as plain Node, not boot an app.
    ELECTRON_RUN_AS_NODE: '1',
    ...(base.WEBUDDY_ENDPOINT ? { WEBUDDY_ENDPOINT: base.WEBUDDY_ENDPOINT } : {})
  }
}

/** Resolves with the exit code; null when the collector failed to spawn or was killed. */
async function runStep(
  entry: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<number | null> {
  // Why never reject: collection must not be able to break the editor. A
  // missing or failing collector leaves the app fully usable.
  try {
    const result = await runProcess({
      program: process.execPath,
      args: [entry, ...args],
      env,
      stdio: 'ignore',
      timeoutMs: STEP_TIMEOUT_MS
    })
    return result.timedOut ? null : result.code
  } catch {
    return null
  }
}

export type CollectionPassDeps = {
  hasCredential: () => Promise<boolean>
  runStep: (args: string[]) => Promise<number | null>
  exportSessions: () => Promise<VaultSessionExportResult>
  log: (message: string, error: unknown) => void
}

/** Signed in = config.json carries both the identity and its upload token. */
export async function collectorHasCredential(env: NodeJS.ProcessEnv): Promise<boolean> {
  const config = await readCollectorConfig(collectorConfigPath(env))
  return (
    typeof config.userId === 'string' &&
    config.userId !== '' &&
    typeof config.token === 'string' &&
    config.token !== ''
  )
}

/** One pass: export changed AI Vault sessions → `scan --manifest` → `push`. */
export async function runCollectionPass(deps: CollectionPassDeps): Promise<void> {
  try {
    // Why: signed out, scan would just exit non-zero and re-export the same batch every pass.
    if (!(await deps.hasCredential())) {
      return await pushOnly(deps)
    }
    const exported = await deps.exportSessions()
    if (exported.count > 0 && exported.manifestPath) {
      try {
        const code = await deps.runStep(['scan', '--manifest', exported.manifestPath])
        // Why only on 0: a failed scan must re-export the same sessions next pass.
        if (code === 0) {
          await exported.commit()
        }
      } finally {
        await exported.dispose()
      }
    }
  } catch (error) {
    deps.log('[webuddy] session export failed', error)
  }
  await pushOnly(deps)
}

// Always push so an outbox queued by earlier passes still drains.
async function pushOnly(deps: CollectionPassDeps): Promise<void> {
  await deps.runStep(['push'])
}

/**
 * Start periodic collection. Safe to call once at startup; later calls are
 * ignored so a second window cannot double-schedule.
 */
export function startSessionCollection(
  options: {
    resourcesPath?: string
    env?: NodeJS.ProcessEnv
    intervalMs?: number
    firstRunDelayMs?: number
    beforeRun?: () => Promise<void>
  } = {}
): void {
  if (timer || process.env.WEBUDDY_DISABLE_COLLECTION === '1') {
    return
  }
  const resourcesPath = options.resourcesPath ?? process.resourcesPath
  const env = sessionCollectorEnv(options.env)
  const entry = sessionCollectorEntryPath(resourcesPath)

  const kick = async (): Promise<void> => {
    if (inFlight) {
      return
    }
    inFlight = true
    try {
      await options.beforeRun?.()
      await runCollectionPass({
        hasCredential: () => collectorHasCredential(env),
        runStep: (args) => runStep(entry, args, env),
        exportSessions: () => exportVaultSessions(productionVaultSessionExportDeps(env)),
        log: (message, error) => console.warn(message, error)
      })
    } finally {
      inFlight = false
    }
  }

  const firstRun = setTimeout(() => void kick(), options.firstRunDelayMs ?? FIRST_RUN_DELAY_MS)
  firstRun.unref?.()
  timer = setInterval(() => void kick(), options.intervalMs ?? INTERVAL_MS)
  timer.unref?.()
}

/** Test seam: stop the schedule without touching app state. */
export function stopSessionCollection(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
