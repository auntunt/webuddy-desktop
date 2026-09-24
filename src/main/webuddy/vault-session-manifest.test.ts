import { relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { toManifestEntry } from './vault-session-manifest'
import type { AiVaultConversationResult } from '../ai-vault/session-conversation-window'
import type { AiVaultSession } from '../../shared/ai-vault-types'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'

function baseSession(overrides: Partial<AiVaultSession> = {}): AiVaultSession {
  return {
    id: 'row-1',
    executionHostId: LOCAL_EXECUTION_HOST_ID,
    executionHostPlatform: 'darwin',
    agent: 'claude',
    sessionId: 'sess-abc',
    title: 'Fix bug',
    cwd: '/Users/lina/project',
    branch: 'main',
    model: 'claude-opus',
    filePath: '/Users/lina/.claude/projects/x/sess-abc.jsonl',
    codexHome: null,
    createdAt: null,
    updatedAt: null,
    modifiedAt: '2026-09-20T10:00:00.000Z',
    messageCount: 4,
    totalTokens: 1200,
    previewMessages: [],
    queuedMessageCount: 0,
    subagentTranscriptCount: 0,
    resumeCommand: 'claude --resume sess-abc',
    subagent: null,
    ...overrides
  }
}

function conversation(
  overrides: Partial<AiVaultConversationResult> = {}
): AiVaultConversationResult {
  return {
    messages: [
      { role: 'user', text: 'hi', timestamp: '2026-09-20T10:00:01.000Z' },
      { role: 'assistant', text: 'hello', timestamp: '2026-09-20T10:00:02.000Z' },
      { role: 'user', text: 'do X', timestamp: '2026-09-20T10:05:00.000Z' }
    ],
    truncated: false,
    totalMessages: 3,
    ...overrides
  }
}

describe('toManifestEntry', () => {
  it('maps the claude agent id/label to the claude-code dedupe-compat identity', () => {
    const entry = toManifestEntry(baseSession(), conversation(), { homeDir: '/Users/lina' })
    expect(entry.agentId).toBe('claude-code')
    expect(entry.agentLabel).toBe('Claude Code')
  })

  it('leaves non-claude agent ids/labels unchanged (e.g. codex)', () => {
    const entry = toManifestEntry(
      baseSession({ agent: 'codex', filePath: '/Users/lina/.codex/sessions/a.jsonl' }),
      conversation(),
      { homeDir: '/Users/lina' }
    )
    expect(entry.agentId).toBe('codex')
    expect(entry.agentLabel).toBe('Codex')
  })

  it('computes relPath identically to path.relative(homedir, filePath)', () => {
    const session = baseSession()
    const entry = toManifestEntry(session, conversation(), { homeDir: '/Users/lina' })
    expect(entry.relPath).toBe(relative('/Users/lina', session.filePath))
  })

  it('prefixes WSL UNC paths with wsl:<distro>/... instead of a home-relative path', () => {
    const session = baseSession({
      filePath: '\\\\wsl.localhost\\Ubuntu\\home\\lina\\.claude\\projects\\x\\sess-abc.jsonl'
    })
    const entry = toManifestEntry(session, conversation(), {
      homeDir: 'C:\\Users\\lina',
      pathModule: { relative: () => 'SHOULD_NOT_BE_USED' }
    })
    expect(entry.relPath).toBe('wsl:Ubuntu/home/lina/.claude/projects/x/sess-abc.jsonl')
  })

  it('uses an injected path module for Windows-style native paths on any host', () => {
    const win32 = { relative: (from: string, to: string) => to.replace(`${from}\\`, '') }
    const session = baseSession({ filePath: 'C:\\Users\\lina\\.claude\\a.jsonl' })
    const entry = toManifestEntry(session, conversation(), {
      homeDir: 'C:\\Users\\lina',
      pathModule: win32
    })
    expect(entry.relPath).toBe('.claude\\a.jsonl')
  })

  describe('timestamp fallback chain', () => {
    it('prefers createdAt/updatedAt when present', () => {
      const session = baseSession({
        createdAt: '2026-09-19T00:00:00.000Z',
        updatedAt: '2026-09-21T00:00:00.000Z'
      })
      const entry = toManifestEntry(session, conversation(), { homeDir: '/Users/lina' })
      expect(entry.startedAt).toBe('2026-09-19T00:00:00.000Z')
      expect(entry.endedAt).toBe('2026-09-21T00:00:00.000Z')
      expect(entry.durationMs).toBe(
        Date.parse('2026-09-21T00:00:00.000Z') - Date.parse('2026-09-19T00:00:00.000Z')
      )
    })

    it('falls back to first/last message timestamps when createdAt/updatedAt are null', () => {
      const entry = toManifestEntry(baseSession(), conversation(), { homeDir: '/Users/lina' })
      expect(entry.startedAt).toBe('2026-09-20T10:00:01.000Z')
      expect(entry.endedAt).toBe('2026-09-20T10:05:00.000Z')
      expect(entry.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('falls back to modifiedAt when there is no timestamp signal at all', () => {
      const entry = toManifestEntry(baseSession(), conversation({ messages: [] }), {
        homeDir: '/Users/lina'
      })
      expect(entry.startedAt).toBe('2026-09-20T10:00:00.000Z')
      expect(entry.endedAt).toBe('2026-09-20T10:00:00.000Z')
      expect(entry.durationMs).toBe(0)
    })
  })

  describe('transcriptFormat', () => {
    it('is raw-file for a plain .jsonl transcript', () => {
      const entry = toManifestEntry(baseSession(), conversation(), { homeDir: '/Users/lina' })
      expect(entry.transcriptFormat).toBe('raw-file')
    })

    it('is raw-file for a plain .json transcript', () => {
      const entry = toManifestEntry(
        baseSession({ filePath: '/Users/lina/.cursor/chats/a.json' }),
        conversation(),
        { homeDir: '/Users/lina' }
      )
      expect(entry.transcriptFormat).toBe('raw-file')
    })

    it('is webuddy.conversation.v1 for a database row addressed by a # suffix', () => {
      const entry = toManifestEntry(
        baseSession({
          agent: 'opencode',
          filePath: '/Users/lina/.opencode/storage.sqlite#sess-abc'
        }),
        conversation(),
        { homeDir: '/Users/lina' }
      )
      expect(entry.transcriptFormat).toBe('webuddy.conversation.v1')
    })

    it('is webuddy.conversation.v1 for a non-jsonl/json file path (e.g. sqlite db)', () => {
      const entry = toManifestEntry(
        baseSession({ agent: 'opencode', filePath: '/Users/lina/.opencode/storage.sqlite' }),
        conversation(),
        { homeDir: '/Users/lina' }
      )
      expect(entry.transcriptFormat).toBe('webuddy.conversation.v1')
    })
  })

  it('counts turnCount as user messages and does not mark it approximate when untruncated', () => {
    const entry = toManifestEntry(baseSession(), conversation(), { homeDir: '/Users/lina' })
    expect(entry.turnCount).toBe(2)
    expect(entry.turnCountApproximate).toBeUndefined()
  })

  it('marks turnCountApproximate when the conversation was truncated', () => {
    const entry = toManifestEntry(
      baseSession(),
      conversation({ truncated: true, totalMessages: 5000 }),
      { homeDir: '/Users/lina' }
    )
    expect(entry.turnCountApproximate).toBe(true)
  })

  it('carries messageCount, tokensTotal, model, cwd, branch, and conversation through', () => {
    const session = baseSession()
    const conv = conversation()
    const entry = toManifestEntry(session, conv, { homeDir: '/Users/lina' })
    expect(entry.messageCount).toBe(4)
    expect(entry.tokensTotal).toBe(1200)
    expect(entry.model).toBe('claude-opus')
    expect(entry.cwd).toBe('/Users/lina/project')
    expect(entry.branch).toBe('main')
    expect(entry.conversation).toEqual(conv.messages)
    expect(entry.conversationTruncated).toBe(false)
  })

  it('maps a zero totalTokens to null', () => {
    const entry = toManifestEntry(baseSession({ totalTokens: 0 }), conversation(), {
      homeDir: '/Users/lina'
    })
    expect(entry.tokensTotal).toBeNull()
  })

  it('computes localDate in the given time zone from startedAt', () => {
    const session = baseSession({ createdAt: '2026-01-01T02:00:00.000Z' })
    const entryUtc = toManifestEntry(session, conversation(), {
      homeDir: '/Users/lina',
      timeZone: 'UTC'
    })
    expect(entryUtc.localDate).toBe('2026-01-01')

    // West of UTC: 02:00 UTC on Jan 1 is still Dec 31 locally.
    const entryLA = toManifestEntry(session, conversation(), {
      homeDir: '/Users/lina',
      timeZone: 'America/Los_Angeles'
    })
    expect(entryLA.localDate).toBe('2025-12-31')
  })
})
