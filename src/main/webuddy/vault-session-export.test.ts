import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { exportVaultSessions, type VaultSessionExportDeps } from './vault-session-export'
import { vaultCursorKey, type VaultCursorMap } from './vault-session-cursor'
import type { AiVaultSession } from '../../shared/ai-vault-types'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import type { AiVaultConversationResult } from '../ai-vault/session-conversation-window'

function session(overrides: Partial<AiVaultSession> = {}): AiVaultSession {
  return {
    id: 'row',
    executionHostId: LOCAL_EXECUTION_HOST_ID,
    executionHostPlatform: 'darwin',
    agent: 'codex',
    sessionId: 'sess-1',
    title: 't',
    cwd: null,
    branch: null,
    model: null,
    filePath: '/Users/lina/.codex/sessions/a.jsonl',
    codexHome: null,
    createdAt: null,
    updatedAt: null,
    modifiedAt: '2026-09-20T10:00:00.000Z',
    messageCount: 1,
    totalTokens: 10,
    previewMessages: [],
    queuedMessageCount: 0,
    subagentTranscriptCount: 0,
    resumeCommand: '',
    subagent: null,
    ...overrides
  }
}

const conversation: AiVaultConversationResult = {
  messages: [{ role: 'user', text: 'hi', timestamp: '2026-09-20T10:00:00.000Z' }],
  truncated: false,
  totalMessages: 1
}

async function setup(
  sessions: AiVaultSession[],
  overrides: Partial<VaultSessionExportDeps> = {}
): Promise<{ deps: VaultSessionExportDeps; saved: VaultCursorMap[]; stateDir: string }> {
  const stateDir = await mkdtemp(join(tmpdir(), 'wbs-vault-export-'))
  const saved: VaultCursorMap[] = []
  const deps: VaultSessionExportDeps = {
    stateDir,
    homeDir: '/Users/lina',
    timeZone: 'UTC',
    listSessions: async () => sessions,
    listSubagents: async () => [],
    readConversation: async () => conversation,
    loadCursor: async () => new Map(),
    saveCursor: async (entries) => {
      saved.push(entries)
    },
    ...overrides
  }
  return { deps, saved, stateDir }
}

async function manifestLines(path: string | null): Promise<Record<string, unknown>[]> {
  if (!path) {
    return []
  }
  const raw = await readFile(path, 'utf8')
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parsed: unknown = JSON.parse(line)
      return typeof parsed === 'object' && parsed !== null ? { ...parsed } : {}
    })
}

describe('exportVaultSessions', () => {
  it('writes one JSON line per changed session to <stateDir>/manifest.jsonl', async () => {
    const a = session({ sessionId: 'a', filePath: '/Users/lina/.codex/a.jsonl' })
    const b = session({
      sessionId: 'b',
      filePath: '/Users/lina/.codex/b.jsonl',
      modifiedAt: '2026-09-21T10:00:00.000Z'
    })
    const { deps, stateDir } = await setup([a, b])
    const result = await exportVaultSessions(deps)
    expect(result.count).toBe(2)
    expect(result.manifestPath).toBe(join(stateDir, 'manifest.jsonl'))
    const lines = await manifestLines(result.manifestPath)
    expect(lines.map((line) => line.sessionId)).toEqual(['b', 'a'])
    expect(lines[0]).toMatchObject({ agentId: 'codex', relPath: '.codex/b.jsonl' })
    // Tmp file was renamed away, not left behind.
    expect((await readdir(stateDir)).sort()).toEqual(['manifest.jsonl'])
  })

  it('only exports sessions that changed since the cursor', async () => {
    const seen = session({ sessionId: 'seen' })
    const fresh = session({ sessionId: 'fresh', filePath: '/Users/lina/.codex/f.jsonl' })
    const cursor: VaultCursorMap = new Map([
      [
        vaultCursorKey(seen),
        { modifiedAt: seen.modifiedAt, updatedAt: null, messageCount: 1, totalTokens: 10 }
      ]
    ])
    const { deps } = await setup([seen, fresh], { loadCursor: async () => cursor })
    const result = await exportVaultSessions(deps)
    expect((await manifestLines(result.manifestPath)).map((l) => l.sessionId)).toEqual(['fresh'])
  })

  it('returns count 0 and no manifest when nothing changed', async () => {
    const { deps } = await setup([])
    const result = await exportVaultSessions(deps)
    expect(result).toMatchObject({ count: 0, manifestPath: null })
  })

  it('caps each round at 200 sessions, newest first', async () => {
    const sessions = Array.from({ length: 250 }, (_, i) =>
      session({
        sessionId: `s${i}`,
        filePath: `/Users/lina/.codex/s${i}.jsonl`,
        modifiedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()
      })
    )
    const { deps, saved } = await setup(sessions)
    const result = await exportVaultSessions(deps)
    expect(result.count).toBe(200)
    const lines = await manifestLines(result.manifestPath)
    expect(lines[0]?.sessionId).toBe('s249')
    expect(lines.at(-1)?.sessionId).toBe('s50')
    await result.commit()
    expect(saved[0]?.size).toBe(200)
  })

  it('saves the cursor only when commit() is called', async () => {
    const a = session()
    const { deps, saved } = await setup([a])
    const result = await exportVaultSessions(deps)
    expect(saved).toHaveLength(0)
    await result.commit()
    expect([...(saved[0]?.keys() ?? [])]).toEqual([vaultCursorKey(a)])
  })

  it('skips a session whose conversation read fails and leaves it out of the cursor', async () => {
    const bad = session({ sessionId: 'bad', filePath: '/Users/lina/.codex/bad.jsonl' })
    const good = session({ sessionId: 'good' })
    const { deps, saved } = await setup([bad, good], {
      readConversation: async (s) => {
        if (s.sessionId === 'bad') {
          throw new Error('service down')
        }
        return conversation
      }
    })
    const result = await exportVaultSessions(deps)
    expect(result.count).toBe(1)
    await result.commit()
    expect([...(saved[0]?.keys() ?? [])]).toEqual([vaultCursorKey(good)])
  })

  it('includes changed Claude subagent sessions of parents that have them', async () => {
    const parent = session({
      agent: 'claude',
      sessionId: 'parent',
      filePath: '/Users/lina/.claude/projects/p/parent.jsonl',
      subagentTranscriptCount: 1
    })
    const child = session({
      agent: 'claude',
      sessionId: 'child',
      filePath: '/Users/lina/.claude/projects/p/parent/subagents/agent-1.jsonl'
    })
    const listSubagents = vi.fn(async () => [child])
    const { deps } = await setup([parent], { listSubagents })
    const result = await exportVaultSessions(deps)
    expect(listSubagents).toHaveBeenCalledWith(parent)
    const lines = await manifestLines(result.manifestPath)
    expect(lines.map((l) => [l.agentId, l.sessionId])).toEqual([
      ['claude-code', 'parent'],
      ['claude-code', 'child']
    ])
  })

  it('does not list subagents for parents without subagent transcripts', async () => {
    const listSubagents = vi.fn(async () => [])
    const { deps } = await setup([session({ agent: 'claude' })], { listSubagents })
    await exportVaultSessions(deps)
    expect(listSubagents).not.toHaveBeenCalled()
  })
})
