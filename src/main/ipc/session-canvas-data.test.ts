import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AiVaultListResult, AiVaultSession } from '../../shared/ai-vault-types'
import type { MessageRow } from '../runtime/orchestration/types'
vi.mock('./session-canvas-sender-trust', () => ({ sessionCanvasSenderRefusal: () => null }))

import {
  EXTERNAL_SESSION_MAX_COUNT,
  EXTERNAL_SESSION_WINDOW_MS,
  createSessionCanvasData,
  type SessionCanvasDataDeps
} from './session-canvas-data'

const NOW = Date.parse('2026-09-26T00:00:00.000Z')

function makeSession(overrides: Partial<AiVaultSession> = {}): AiVaultSession {
  return {
    id: 'id-1',
    executionHostId: 'local',
    agent: 'claude',
    sessionId: 'provider-session-1',
    title: 'Fix the bug',
    cwd: '/work/repo',
    branch: null,
    model: null,
    filePath: '/home/.claude/sessions/id-1.jsonl',
    codexHome: null,
    createdAt: null,
    updatedAt: new Date(NOW).toISOString(),
    modifiedAt: new Date(NOW).toISOString(),
    messageCount: 4,
    totalTokens: 100,
    previewMessages: [
      { role: 'user', text: 'a'.repeat(400), timestamp: '2026-09-25T00:00:00.000Z' },
      { role: 'assistant', text: 'ok', timestamp: '2026-09-25T00:00:01.000Z' },
      { role: 'user', text: 'thanks', timestamp: '2026-09-25T00:00:02.000Z' },
      { role: 'assistant', text: 'done', timestamp: '2026-09-25T00:00:03.000Z' }
    ],
    queuedMessageCount: 0,
    subagentTranscriptCount: 0,
    resumeCommand: 'claude resume',
    subagent: null,
    ...overrides
  }
}

function makeMessage(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 'm1',
    run_id: 'run-1',
    from_handle: 'term_a',
    to_handle: 'term_b',
    subject: 'status',
    body: 'body',
    type: 'status',
    priority: 'normal',
    thread_id: null,
    payload: null,
    read: 0,
    sequence: 1,
    created_at: new Date(NOW - 1000).toISOString(),
    delivered_at: new Date(NOW).toISOString(),
    sender_pane_key: 'pane-a',
    ...overrides
  }
}

function makeDeps(overrides: Partial<SessionCanvasDataDeps> = {}): SessionCanvasDataDeps {
  const emptyResult: AiVaultListResult = { sessions: [], issues: [], scannedAt: '' }
  return {
    listAiVaultSessions: vi.fn(async () => emptyResult),
    getMailboxInbox: vi.fn(() => []),
    passAlongLogFilePath: '/tmp/does-not-matter.json',
    now: () => NOW,
    ...overrides
  }
}

describe('listExternalSessions', () => {
  it('maps an AI Vault session into the canvas shape, truncating preview text and keeping the last 3 turns', async () => {
    const session = makeSession()
    const deps = makeDeps({
      listAiVaultSessions: vi.fn(async () => ({
        sessions: [session],
        issues: [],
        scannedAt: ''
      }))
    })
    const result = await createSessionCanvasData(deps).listExternalSessions()
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.sessions).toHaveLength(1)
    const mapped = result.sessions[0]
    expect(mapped).toMatchObject({
      key: 'id-1',
      agent: 'claude',
      agentLabel: 'Claude',
      title: 'Fix the bug',
      cwd: '/work/repo',
      filePath: session.filePath,
      providerSessionId: 'provider-session-1'
    })
    expect(mapped?.preview).toHaveLength(3)
    expect(mapped?.preview[0]?.role).toBe('assistant')
    expect(deps.listAiVaultSessions).toHaveBeenCalledWith({ unlimited: false })
  })

  it('drops sessions older than the 7-day window and caps the result at 200', async () => {
    const fresh = makeSession({ id: 'fresh' })
    const stale = makeSession({
      id: 'stale',
      updatedAt: new Date(NOW - EXTERNAL_SESSION_WINDOW_MS - 1).toISOString(),
      modifiedAt: new Date(NOW - EXTERNAL_SESSION_WINDOW_MS - 1).toISOString()
    })
    const many = Array.from({ length: EXTERNAL_SESSION_MAX_COUNT + 5 }, (_, i) =>
      makeSession({
        id: `s${i}`,
        updatedAt: new Date(NOW - i).toISOString(),
        modifiedAt: new Date(NOW - i).toISOString()
      })
    )
    const deps = makeDeps({
      listAiVaultSessions: vi.fn(async () => ({
        sessions: [fresh, stale, ...many],
        issues: [],
        scannedAt: ''
      }))
    })
    const result = await createSessionCanvasData(deps).listExternalSessions()
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.sessions).toHaveLength(EXTERNAL_SESSION_MAX_COUNT)
    expect(result.sessions.some((s) => s.key === 'stale')).toBe(false)
  })
})

describe('listMessages', () => {
  it('projects a delivered mailbox message and filters undelivered ones out', async () => {
    const delivered = makeMessage({ id: 'delivered' })
    const undelivered = makeMessage({ id: 'undelivered', delivered_at: null })
    const deps = makeDeps({ getMailboxInbox: vi.fn(() => [delivered, undelivered]) })
    const result = await createSessionCanvasData(deps).listMessages({ sinceMs: 0 })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.messages).toEqual([
      {
        fromPaneKey: 'pane-a',
        toPaneKey: null,
        fromHandle: 'term_a',
        toHandle: 'term_b',
        at: NOW,
        kind: 'mailbox'
      }
    ])
  })

  it('honors sinceMs as a lower bound', async () => {
    const old = makeMessage({ id: 'old', delivered_at: new Date(NOW - 5000).toISOString() })
    const recent = makeMessage({ id: 'recent', delivered_at: new Date(NOW).toISOString() })
    const deps = makeDeps({ getMailboxInbox: vi.fn(() => [old, recent]) })
    const result = await createSessionCanvasData(deps).listMessages({ sinceMs: NOW - 1000 })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.at).toBe(NOW)
  })
})

describe('recordPassAlong', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'session-canvas-data-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns ok:true and makes the entry visible via listMessages', async () => {
    const deps = makeDeps({ passAlongLogFilePath: join(dir, 'pass-along-log.json') })
    const data = createSessionCanvasData(deps)
    const result = await data.recordPassAlong({ fromPaneKey: 'pane-a', toPaneKey: 'pane-b' })
    expect(result).toEqual({ ok: true })
    const listed = await data.listMessages({ sinceMs: 0 })
    expect(listed.ok).toBe(true)
    if (!listed.ok) {
      return
    }
    expect(listed.messages).toEqual([
      {
        fromPaneKey: 'pane-a',
        toPaneKey: 'pane-b',
        fromHandle: null,
        toHandle: null,
        at: NOW,
        kind: 'pass-along'
      }
    ])
  })
})
