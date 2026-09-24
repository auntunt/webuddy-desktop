import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  loadVaultExportFailures,
  saveVaultExportFailures,
  vaultExportFailuresPath
} from './vault-export-failures'

async function tempEnv(): Promise<NodeJS.ProcessEnv> {
  return {
    WEBUDDY_AGENT_HOME: await mkdtemp(join(tmpdir(), 'wbs-vault-failures-'))
  }
}

const value = {
  modifiedAt: '2026-09-20T10:00:00.000Z',
  updatedAt: null,
  messageCount: 1,
  totalTokens: 0
}

describe('vault export failures file', () => {
  it('round-trips failure records', async () => {
    const env = await tempEnv()
    await saveVaultExportFailures(new Map([['k', { value, count: 2 }]]), env)
    expect(await loadVaultExportFailures(env)).toEqual(new Map([['k', { value, count: 2 }]]))
  })

  it('treats a missing or corrupt file as empty and drops malformed rows', async () => {
    const env = await tempEnv()
    expect(await loadVaultExportFailures(env)).toEqual(new Map())
    await writeFile(
      vaultExportFailuresPath(env),
      JSON.stringify({ ok: { value, count: 1 }, bad: { count: 'x' } })
    )
    expect([...(await loadVaultExportFailures(env)).keys()]).toEqual(['ok'])
    await writeFile(vaultExportFailuresPath(env), '{not json')
    expect(await loadVaultExportFailures(env)).toEqual(new Map())
  })
})
