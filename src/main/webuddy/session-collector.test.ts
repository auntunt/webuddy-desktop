import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { collectorHasCredential, runCollectionPass, sessionCollectorEnv } from './session-collector'
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
  scanExitCode: number | null = 0,
  signedIn = true
): {
  exportSessions: ReturnType<typeof vi.fn>
  steps: string[][]
  commit: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  log: ReturnType<typeof vi.fn>
  run: () => Promise<void>
} {
  const steps: string[][] = []
  const commit = vi.fn(async () => {})
  const dispose = vi.fn(async () => {})
  const log = vi.fn()
  const result = exported instanceof Error ? exported : { ...exported, commit, dispose }
  const exportSessions = vi.fn(async () => {
    if (result instanceof Error) {
      throw result
    }
    return result
  })
  const run = (): Promise<void> =>
    runCollectionPass({
      hasCredential: async () => signedIn,
      runStep: async (args) => {
        steps.push(args)
        return args[0] === 'scan' ? scanExitCode : 0
      },
      exportSessions,
      log
    })
  return { exportSessions, steps, commit, dispose, log, run }
}

describe('runCollectionPass', () => {
  const exported = {
    manifestPath: '/state/manifest.jsonl',
    count: 3,
    commit: async () => {},
    dispose: async () => {}
  }

  it('runs scan --manifest then push, and commits the cursor on exit 0', async () => {
    const { steps, commit, run } = passDeps(exported, 0)
    await run()
    expect(steps).toEqual([['scan', '--manifest', '/state/manifest.jsonl'], ['push']])
    expect(commit).toHaveBeenCalledOnce()
  })

  it('disposes the manifest after scan whether or not it succeeded', async () => {
    for (const code of [0, 1]) {
      const { dispose, run } = passDeps(exported, code)
      await run()
      expect(dispose).toHaveBeenCalledOnce()
    }
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
      commit: async () => {},
      dispose: async () => {}
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

  it('skips export and scan when signed out, but still pushes', async () => {
    const { exportSessions, steps, commit, run } = passDeps(exported, 0, false)
    await run()
    expect(exportSessions).not.toHaveBeenCalled()
    expect(steps).toEqual([['push']])
    expect(commit).not.toHaveBeenCalled()
  })
})

describe('collectorHasCredential', () => {
  it('requires both userId and token in config.json', async () => {
    const home = await mkdtemp(join(tmpdir(), 'webuddy-cred-'))
    const env = { WEBUDDY_AGENT_HOME: home }
    try {
      expect(await collectorHasCredential(env)).toBe(false)
      await writeFile(join(home, 'config.json'), JSON.stringify({ userId: 'u1', token: '' }))
      expect(await collectorHasCredential(env)).toBe(false)
      await writeFile(join(home, 'config.json'), JSON.stringify({ token: 't' }))
      expect(await collectorHasCredential(env)).toBe(false)
      await writeFile(join(home, 'config.json'), JSON.stringify({ userId: 'u1', token: 't' }))
      expect(await collectorHasCredential(env)).toBe(true)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
