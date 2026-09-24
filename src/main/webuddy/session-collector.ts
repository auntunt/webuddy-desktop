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

import { spawn } from 'node:child_process'
import { join } from 'node:path'
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
function runStep(entry: string, args: string[], env: NodeJS.ProcessEnv): Promise<number | null> {
  return new Promise((resolve) => {
    // Why never reject: collection must not be able to break the editor. A
    // missing or failing collector leaves the app fully usable.
    const child = spawn(process.execPath, [entry, ...args], {
      env,
      stdio: 'ignore',
      windowsHide: true
    })
    const killTimer = setTimeout(() => child.kill('SIGKILL'), STEP_TIMEOUT_MS)
    killTimer.unref?.()
    child.on('error', () => {
      clearTimeout(killTimer)
      resolve(null)
    })
    child.on('exit', (code) => {
      clearTimeout(killTimer)
      resolve(code)
    })
  })
}

export type CollectionPassDeps = {
  runStep: (args: string[]) => Promise<number | null>
  exportSessions: () => Promise<VaultSessionExportResult>
  log: (message: string, error: unknown) => void
}

/** One pass: export changed AI Vault sessions → `scan --manifest` → `push`. */
export async function runCollectionPass(deps: CollectionPassDeps): Promise<void> {
  try {
    const exported = await deps.exportSessions()
    if (exported.count > 0 && exported.manifestPath) {
      const code = await deps.runStep(['scan', '--manifest', exported.manifestPath])
      // Why only on 0: a failed scan must re-export the same sessions next pass.
      if (code === 0) {
        await exported.commit()
      }
    }
  } catch (error) {
    deps.log('[webuddy] session export failed', error)
  }
  // Always push so an outbox queued by earlier passes still drains.
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
