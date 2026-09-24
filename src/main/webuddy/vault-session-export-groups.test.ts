import { writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { exportVaultSessions } from './vault-session-export'
import { vaultCursorKey, vaultCursorValueFor, type VaultCursorMap } from './vault-session-cursor'
import type { VaultExportFailureMap } from './vault-export-failures'
import type { AiVaultSession } from '../../shared/ai-vault-types'
import type { AiVaultConversationResult } from '../ai-vault/session-conversation-window'
import { conversation, manifestLines, session, setup } from './vault-session-export-test-fixture'

describe('parent + subagent groups', () => {
  const parent = session({
    agent: 'claude',
    sessionId: 'parent',
    filePath: '/Users/lina/.claude/projects/p/parent.jsonl',
    modifiedAt: '2026-09-22T10:00:00.000Z',
    subagentTranscriptCount: 2
  })
  const child = (n: number): AiVaultSession =>
    session({
      agent: 'claude',
      sessionId: `child${n}`,
      filePath: `/Users/lina/.claude/projects/p/parent/subagents/agent-${n}.jsonl`
    })

  async function committedKeys(result: { commit: () => Promise<void> }, saved: VaultCursorMap[]) {
    await result.commit()
    return [...(saved[0]?.keys() ?? [])]
  }

  it('commits the parent when all of its changed subagents were written', async () => {
    const { deps, saved } = await setup([parent], {
      listSubagents: async () => [child(1)]
    })
    const keys = await committedKeys(await exportVaultSessions(deps), saved)
    expect(keys).toContain(vaultCursorKey(parent))
    expect(keys).toContain(vaultCursorKey(child(1)))
  })

  it('does not commit the parent when listing subagents throws', async () => {
    const { deps, saved } = await setup([parent], {
      listSubagents: async () => {
        throw new Error('boom')
      }
    })
    const result = await exportVaultSessions(deps)
    expect(result.count).toBe(1)
    expect(await committedKeys(result, saved)).not.toContain(vaultCursorKey(parent))
  })

  it('does not commit the parent when a subagent read fails', async () => {
    const { deps, saved } = await setup([parent], {
      listSubagents: async () => [child(1), child(2)],
      readConversation: async (s) => {
        if (s.sessionId === 'child2') {
          throw new Error('unreadable')
        }
        return conversation
      }
    })
    const keys = await committedKeys(await exportVaultSessions(deps), saved)
    expect(keys).toEqual([vaultCursorKey(child(1))])
  })

  it('writes what fits of an oversized first group without committing the parent', async () => {
    const { deps, saved } = await setup([parent], {
      limit: 2,
      listSubagents: async () => [child(1), child(2)]
    })
    const result = await exportVaultSessions(deps)
    expect(result.count).toBe(2)
    expect(await committedKeys(result, saved)).toEqual([vaultCursorKey(child(1))])
  })

  it('defers a whole later group that does not fit, sharing the cap with a non-empty cursor', async () => {
    const seen = session({
      sessionId: 'seen',
      filePath: '/Users/lina/.codex/seen.jsonl'
    })
    const newest = session({
      sessionId: 'newest',
      filePath: '/Users/lina/.codex/newest.jsonl',
      modifiedAt: '2026-09-23T10:00:00.000Z'
    })
    const older = session({
      sessionId: 'older',
      filePath: '/Users/lina/.codex/older.jsonl',
      modifiedAt: '2026-09-01T10:00:00.000Z'
    })
    const cursor: VaultCursorMap = new Map([[vaultCursorKey(seen), vaultCursorValueFor(seen)]])
    const { deps, saved } = await setup([seen, newest, parent, older], {
      limit: 3,
      loadCursor: async () => cursor,
      listSubagents: async () => [child(1), child(2)]
    })
    const result = await exportVaultSessions(deps)
    const lines = await manifestLines(result.manifestPath)
    // parent group (3) cannot fit after `newest`; deferred intact, `older` still fits.
    expect(lines.map((l) => l.sessionId)).toEqual(['newest', 'older'])
    const keys = await committedKeys(result, saved)
    expect(keys).not.toContain(vaultCursorKey(parent))
    expect(keys).toContain(vaultCursorKey(seen))
  })
})

describe('exportVaultSessions file lifecycle and failures', () => {
  it('removes the tmp manifest and rethrows when the stream fails', async () => {
    const { deps, stateDir } = await setup([session()], {
      openManifestStream: (path) => {
        writeFileSync(path, 'partial')
        return new Writable({
          write: (_chunk, _enc, callback) => callback(new Error('disk full'))
        })
      }
    })
    await expect(exportVaultSessions(deps)).rejects.toThrow('disk full')
    expect(await readdir(stateDir)).toEqual([])
  })

  it('dispose() deletes the manifest (it holds pre-redaction text)', async () => {
    const { deps, stateDir } = await setup([session()])
    const result = await exportVaultSessions(deps)
    await result.dispose()
    expect(await readdir(stateDir)).toEqual([])
  })

  it('overwrites a stale fixed-name tmp file from a crashed pass', async () => {
    const { deps, stateDir } = await setup([session()])
    writeFileSync(join(stateDir, 'manifest.jsonl.tmp'), 'stale\n')
    const result = await exportVaultSessions(deps)
    expect(await manifestLines(result.manifestPath)).toHaveLength(1)
    expect(await readdir(stateDir)).toEqual(['manifest.jsonl'])
  })

  it('gives up on a session after 3 consecutive read failures until it changes', async () => {
    const bad = session({ sessionId: 'bad' })
    const failures: VaultExportFailureMap = new Map()
    const readConversation = vi.fn(async (): Promise<AiVaultConversationResult> => {
      throw new Error('corrupt')
    })
    const run = async (s: AiVaultSession): Promise<void> => {
      const { deps } = await setup([s], {
        readConversation,
        loadFailures: async () => new Map(failures),
        saveFailures: async (next) => {
          failures.clear()
          for (const [k, v] of next) {
            failures.set(k, v)
          }
        }
      })
      await exportVaultSessions(deps)
    }
    for (let i = 0; i < 4; i++) {
      await run(bad)
    }
    expect(readConversation).toHaveBeenCalledTimes(3)
    await run({ ...bad, modifiedAt: '2026-09-24T00:00:00.000Z' })
    expect(readConversation).toHaveBeenCalledTimes(4)
  })

  it('clears the failure record once a session reads successfully', async () => {
    const s = session()
    const failures: VaultExportFailureMap = new Map([
      [vaultCursorKey(s), { value: vaultCursorValueFor(s), count: 2 }]
    ])
    const { deps, savedFailures } = await setup([s], {
      loadFailures: async () => failures
    })
    await exportVaultSessions(deps)
    expect(savedFailures.at(-1)?.size).toBe(0)
  })
})
