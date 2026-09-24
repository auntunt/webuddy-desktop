import { describe, expect, it, vi } from 'vitest'
import { runCollectionPass, sessionCollectorEnv } from './session-collector'
import type { VaultSessionExportResult } from './vault-session-export'

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

function passDeps(
  exported: VaultSessionExportResult | Error,
  scanExitCode: number | null = 0
): {
  steps: string[][]
  commit: ReturnType<typeof vi.fn>
  log: ReturnType<typeof vi.fn>
  run: () => Promise<void>
} {
  const steps: string[][] = []
  const commit = vi.fn(async () => {})
  const log = vi.fn()
  const result = exported instanceof Error ? exported : { ...exported, commit }
  const run = (): Promise<void> =>
    runCollectionPass({
      runStep: async (args) => {
        steps.push(args)
        return args[0] === 'scan' ? scanExitCode : 0
      },
      exportSessions: async () => {
        if (result instanceof Error) {
          throw result
        }
        return result
      },
      log
    })
  return { steps, commit, log, run }
}

describe('runCollectionPass', () => {
  const exported = { manifestPath: '/state/manifest.jsonl', count: 3, commit: async () => {} }

  it('runs scan --manifest then push, and commits the cursor on exit 0', async () => {
    const { steps, commit, run } = passDeps(exported, 0)
    await run()
    expect(steps).toEqual([['scan', '--manifest', '/state/manifest.jsonl'], ['push']])
    expect(commit).toHaveBeenCalledOnce()
  })

  it('does not commit the cursor when scan exits non-zero', async () => {
    const { steps, commit, run } = passDeps(exported, 1)
    await run()
    expect(commit).not.toHaveBeenCalled()
    expect(steps.at(-1)).toEqual(['push'])
  })

  it('does not commit when scan could not be spawned (null exit code)', async () => {
    const { commit, run } = passDeps(exported, null)
    await run()
    expect(commit).not.toHaveBeenCalled()
  })

  it('skips scan when nothing changed but still pushes the outbox', async () => {
    const { steps, commit, run } = passDeps({
      manifestPath: null,
      count: 0,
      commit: async () => {}
    })
    await run()
    expect(steps).toEqual([['push']])
    expect(commit).not.toHaveBeenCalled()
  })

  it('swallows export failures, logs once, and still pushes', async () => {
    const { steps, log, run } = passDeps(new Error('vault service down'))
    await expect(run()).resolves.toBeUndefined()
    expect(log).toHaveBeenCalledOnce()
    expect(steps).toEqual([['push']])
  })
})
