import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  diffVaultSessions,
  loadVaultCursor,
  saveVaultCursor,
  vaultCursorKey,
  vaultCursorPath,
  type VaultCursorMap
} from './vault-session-cursor'
import type { AiVaultSession } from '../../shared/ai-vault-types'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'

function session(overrides: Partial<AiVaultSession> = {}): AiVaultSession {
  return {
    id: 'row',
    executionHostId: LOCAL_EXECUTION_HOST_ID,
    executionHostPlatform: 'darwin',
    agent: 'claude',
    sessionId: 'sess-1',
    title: 't',
    cwd: null,
    branch: null,
    model: null,
    filePath: '/Users/lina/.claude/a.jsonl',
    codexHome: null,
    createdAt: null,
    updatedAt: null,
    modifiedAt: '2026-09-20T10:00:00.000Z',
    messageCount: 1,
    totalTokens: 10,
    previewMessages: [],
    queuedMessageCount: 0,
    subagentTranscriptCount: 0,
    resumeCommand: 'claude --resume sess-1',
    subagent: null,
    ...overrides
  }
}

async function tempEnv(): Promise<{ home: string; env: NodeJS.ProcessEnv }> {
  const home = await mkdtemp(join(tmpdir(), 'wbs-vault-cursor-'))
  return { home, env: { WEBUDDY_AGENT_HOME: home } }
}

describe('vaultCursorPath', () => {
  it('lives beside the collector state dir', async () => {
    const { home, env } = await tempEnv()
    expect(vaultCursorPath(env)).toBe(join(home, 'vault-cursor.json'))
  })
})

describe('loadVaultCursor', () => {
  it('returns an empty map when the file does not exist', async () => {
    const { env } = await tempEnv()
    expect(await loadVaultCursor(env)).toEqual(new Map())
  })

  it('falls back to an empty map for a corrupt file', async () => {
    const { env } = await tempEnv()
    await writeFile(vaultCursorPath(env), '{ not valid json')
    expect(await loadVaultCursor(env)).toEqual(new Map())
  })

  it('falls back to an empty map when the file is not a JSON object', async () => {
    const { env } = await tempEnv()
    await writeFile(vaultCursorPath(env), '[1,2,3]')
    expect(await loadVaultCursor(env)).toEqual(new Map())
  })

  it('drops malformed individual entries but keeps valid ones', async () => {
    const { env } = await tempEnv()
    await writeFile(
      vaultCursorPath(env),
      JSON.stringify({
        good: { modifiedAt: 'x', updatedAt: null, messageCount: 1, totalTokens: 2 },
        bad: { modifiedAt: 123 }
      })
    )
    const cursor = await loadVaultCursor(env)
    expect(cursor.has('good')).toBe(true)
    expect(cursor.has('bad')).toBe(false)
  })

  it('round-trips what saveVaultCursor wrote', async () => {
    const { env } = await tempEnv()
    const cursor: VaultCursorMap = new Map([
      [
        'claude\0/a.jsonl\0sess-1',
        { modifiedAt: 'x', updatedAt: 'y', messageCount: 3, totalTokens: 5 }
      ]
    ])
    await saveVaultCursor(cursor, env)
    expect(await loadVaultCursor(env)).toEqual(cursor)
  })
})

describe('saveVaultCursor', () => {
  it('writes atomically (no leftover tmp file) with 0600 permissions', async () => {
    const { env } = await tempEnv()
    await saveVaultCursor(
      new Map([['k', { modifiedAt: 'x', updatedAt: null, messageCount: 0, totalTokens: 0 }]]),
      env
    )
    const path = vaultCursorPath(env)
    const contents = await readFile(path, 'utf8')
    expect(JSON.parse(contents)).toEqual({
      k: { modifiedAt: 'x', updatedAt: null, messageCount: 0, totalTokens: 0 }
    })
    const mode = (await stat(path)).mode & 0o777
    expect(mode).toBe(0o600)
  })
})

describe('diffVaultSessions', () => {
  it('treats a session absent from the cursor as changed', () => {
    const s = session()
    const { changed } = diffVaultSessions([s], new Map(), { limit: 200 })
    expect(changed).toEqual([s])
  })

  it('treats a session whose cursor value matches as unchanged', () => {
    const s = session()
    const cursor: VaultCursorMap = new Map([
      [
        vaultCursorKey(s),
        {
          modifiedAt: s.modifiedAt,
          updatedAt: s.updatedAt,
          messageCount: s.messageCount,
          totalTokens: s.totalTokens
        }
      ]
    ])
    const { changed } = diffVaultSessions([s], cursor, { limit: 200 })
    expect(changed).toEqual([])
  })

  it('treats a session as changed when messageCount/totalTokens/modifiedAt/updatedAt differ', () => {
    const s = session({ messageCount: 5 })
    const cursor: VaultCursorMap = new Map([
      [
        vaultCursorKey(s),
        {
          modifiedAt: s.modifiedAt,
          updatedAt: s.updatedAt,
          messageCount: 1,
          totalTokens: s.totalTokens
        }
      ]
    ])
    const { changed } = diffVaultSessions([s], cursor, { limit: 200 })
    expect(changed).toEqual([s])
  })

  it('orders changed sessions newest-first by modifiedAt', () => {
    const older = session({ sessionId: 'old', modifiedAt: '2026-09-19T00:00:00.000Z' })
    const newer = session({ sessionId: 'new', modifiedAt: '2026-09-21T00:00:00.000Z' })
    const { changed } = diffVaultSessions([older, newer], new Map(), { limit: 200 })
    expect(changed.map((s) => s.sessionId)).toEqual(['new', 'old'])
  })

  it('caps changed sessions at the limit, leaving the rest for next round', () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      session({ sessionId: `s${i}`, modifiedAt: `2026-09-${10 + i}T00:00:00.000Z` })
    )
    const { changed } = diffVaultSessions(sessions, new Map(), { limit: 2 })
    expect(changed).toHaveLength(2)
    // Newest-first: the two most recently modified.
    expect(changed.map((s) => s.sessionId)).toEqual(['s4', 's3'])
  })

  it('only advances the cursor for sessions actually included in this round', () => {
    const sessions = Array.from({ length: 3 }, (_, i) =>
      session({ sessionId: `s${i}`, modifiedAt: `2026-09-${10 + i}T00:00:00.000Z` })
    )
    const { changed, nextCursorEntries } = diffVaultSessions(sessions, new Map(), { limit: 2 })
    expect(changed).toHaveLength(2)
    expect(nextCursorEntries.size).toBe(2)
    expect(nextCursorEntries.has(vaultCursorKey(sessions[0]))).toBe(false)
  })

  it('preserves untouched cursor entries for sessions not in this batch', () => {
    const untouched = session({ sessionId: 'kept', filePath: '/x/kept.jsonl' })
    const cursor: VaultCursorMap = new Map([
      [
        vaultCursorKey(untouched),
        { modifiedAt: untouched.modifiedAt, updatedAt: null, messageCount: 1, totalTokens: 1 }
      ]
    ])
    const changedSession = session({ sessionId: 'changed', filePath: '/x/changed.jsonl' })
    const { nextCursorEntries } = diffVaultSessions([changedSession], cursor, { limit: 200 })
    expect(nextCursorEntries.has(vaultCursorKey(untouched))).toBe(true)
    expect(nextCursorEntries.has(vaultCursorKey(changedSession))).toBe(true)
  })
})
