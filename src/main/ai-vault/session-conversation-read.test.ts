import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Only the thread hop is replaced; the in-process readers are the worker's own.
vi.mock('./session-scanner-opencode-sqlite-worker-spawn', async () => {
  const list = await import('./session-scanner-opencode-sqlite-list')
  const parse = await import('./session-scanner-opencode-sqlite')
  const capture = await import('./session-scanner-opencode-sqlite-capture')
  return {
    resolveOpenCodeSqliteWorkerEntryPath: () => null,
    listOpenCodeSqliteSessionsViaWorker: (
      args: Parameters<typeof list.listOpenCodeSqliteSessions>[0]
    ) => list.listOpenCodeSqliteSessions(args),
    parseOpenCodeSqliteSessionViaWorker: (
      args: Parameters<typeof parse.parseOpenCodeSqliteSession>[0]
    ) => parse.parseOpenCodeSqliteSession(args),
    captureOpenCodeSqliteSessionViaWorker: (
      args: Parameters<typeof capture.captureOpenCodeSqliteSession>[0]
    ) => capture.captureOpenCodeSqliteSession(args)
  }
})
import { AI_VAULT_AGENTS } from '../../shared/ai-vault-types'
import { readAiVaultConversation } from './session-conversation-read'
import {
  CONVERSATION_HEAD_MESSAGES,
  CONVERSATION_MAX_MESSAGE_BYTES,
  CONVERSATION_MAX_TOTAL_BYTES,
  CONVERSATION_TAIL_MESSAGES
} from './session-conversation-window'
import { readAiVaultConversationInBackground } from './session-scanner-background'
import { scanAiVaultSessions } from './session-scanner'
import { writeEveryAgentVault } from './session-scanner-every-agent-fixture'
import { writeOpenCodeSqliteDatabase } from './session-scanner-opencode-sqlite-fixture'
import { resetSessionParseCacheForTests } from './session-scanner-parse-cache'

let tempRoots: string[] = []

afterEach(async () => {
  resetSessionParseCacheForTests()
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })))
  tempRoots = []
})

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

async function writeClaudeSession(lines: number, text: (i: number) => string): Promise<string> {
  const root = await tempRoot('orca-conversation-claude-')
  const projectDir = join(root, 'project')
  await mkdir(projectDir, { recursive: true })
  const filePath = join(projectDir, 'session.jsonl')
  const rows: string[] = []
  for (let i = 0; i < lines; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant'
    rows.push(
      JSON.stringify({
        type: role,
        sessionId: 'conversation-session',
        timestamp: new Date(Date.UTC(2026, 4, 1, 10, 0, i)).toISOString(),
        cwd: '/repo/app',
        message: { role, content: text(i) }
      })
    )
  }
  await writeFile(filePath, rows.join('\n'))
  return filePath
}

describe('readAiVaultConversation', () => {
  it('returns user and assistant messages for every supported agent', async () => {
    const root = await tempRoot('orca-conversation-every-agent-')
    const { roots } = await writeEveryAgentVault(root)
    const dbPath = join(root, 'opencode-db', 'opencode.db')
    writeOpenCodeSqliteDatabase(dbPath, [
      {
        id: 'ses_conversation',
        turns: [
          { role: 'user', parts: ['sqlite question'] },
          { role: 'assistant', parts: ['sqlite answer'] }
        ]
      }
    ])
    const scan = await scanAiVaultSessions({
      ...roots,
      opencodeDbPaths: [dbPath],
      platform: 'darwin',
      limit: 40
    })
    expect(new Set(scan.sessions.map((session) => session.agent))).toEqual(new Set(AI_VAULT_AGENTS))

    const silent: string[] = []
    for (const session of scan.sessions) {
      const result = await readAiVaultConversation({
        agent: session.agent,
        filePath: session.filePath,
        sessionId: session.sessionId,
        codexHome: session.codexHome
      })
      const spoke = result.messages.some((m) => m.role === 'user' || m.role === 'assistant')
      if (!spoke) {
        silent.push(`${session.agent}:${session.filePath}`)
      }
      expect(result.totalMessages).toBe(result.messages.length)
      expect(result.truncated).toBe(false)
    }
    expect(silent).toEqual([])
  })

  it('reads an OpenCode SQLite session by db path + session id and by synthetic path', async () => {
    const root = await tempRoot('orca-conversation-opencode-')
    const dbPath = join(root, 'opencode.db')
    writeOpenCodeSqliteDatabase(dbPath, [
      {
        id: 'ses_direct',
        turns: [
          { role: 'user', parts: ['first ask'] },
          { role: 'assistant', parts: ['first reply'] }
        ]
      }
    ])
    const expected = [
      { role: 'user', text: 'first ask', timestamp: expect.any(String) },
      { role: 'assistant', text: 'first reply', timestamp: expect.any(String) }
    ]
    const byId = await readAiVaultConversation({
      agent: 'opencode',
      filePath: dbPath,
      sessionId: 'ses_direct'
    })
    expect(byId.messages).toEqual(expected)
    const bySynthetic = await readAiVaultConversation({
      agent: 'opencode',
      filePath: `${dbPath}#ses_direct`
    })
    expect(bySynthetic.messages).toEqual(expected)
  })

  it('keeps the first 200 and last 1800 messages of a long session', async () => {
    const total = 2_100
    const filePath = await writeClaudeSession(total, (i) => `message ${i}`)
    const result = await readAiVaultConversation({ agent: 'claude', filePath })

    expect(result.totalMessages).toBe(total)
    expect(result.truncated).toBe(true)
    expect(result.messages).toHaveLength(CONVERSATION_HEAD_MESSAGES + CONVERSATION_TAIL_MESSAGES)
    expect(result.messages[0].text).toBe('message 0')
    expect(result.messages[CONVERSATION_HEAD_MESSAGES - 1].text).toBe('message 199')
    expect(result.messages[CONVERSATION_HEAD_MESSAGES].text).toBe(`message ${total - 1800}`)
    expect(result.messages.at(-1)?.text).toBe(`message ${total - 1}`)
  })

  it('caps each message at 16 KB and the whole conversation at 1 MB', async () => {
    const big = 'x'.repeat(40_000)
    const filePath = await writeClaudeSession(200, (i) => `${i}:${big}`)
    const result = await readAiVaultConversation({ agent: 'claude', filePath })

    expect(result.truncated).toBe(true)
    expect(result.totalMessages).toBe(200)
    const bytes = result.messages.map((m) => Buffer.byteLength(m.text, 'utf8'))
    expect(Math.max(...bytes)).toBeLessThanOrEqual(CONVERSATION_MAX_MESSAGE_BYTES)
    expect(bytes.reduce((sum, n) => sum + n, 0)).toBeLessThanOrEqual(CONVERSATION_MAX_TOTAL_BYTES)
    // Head and newest tail survive; the middle is what gives way.
    expect(result.messages[0].text.startsWith('0:')).toBe(true)
    expect(result.messages.at(-1)?.text.startsWith('199:')).toBe(true)
  })

  it('never splits a multi-byte character when capping a message', async () => {
    const filePath = await writeClaudeSession(1, () => '汉'.repeat(10_000))
    const result = await readAiVaultConversation({ agent: 'claude', filePath })
    const text = result.messages[0].text
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(CONVERSATION_MAX_MESSAGE_BYTES)
    expect(text).not.toContain('�')
    expect(result.truncated).toBe(true)
  })

  it('returns an empty conversation for non-local hosts and missing files', async () => {
    const filePath = await writeClaudeSession(2, (i) => `message ${i}`)
    const empty = { messages: [], truncated: false, totalMessages: 0 }
    await expect(
      readAiVaultConversation({ agent: 'claude', filePath, executionHostId: 'ssh:remote-box' })
    ).resolves.toEqual(empty)
    await expect(
      readAiVaultConversation({ agent: 'claude', filePath: join(filePath, 'missing.jsonl') })
    ).resolves.toEqual(empty)
    await expect(readAiVaultConversation({ agent: 'claude', filePath: '  ' })).resolves.toEqual(
      empty
    )
  })

  it('falls back to the in-process reader outside the service process', async () => {
    const filePath = await writeClaudeSession(2, (i) => `message ${i}`)
    const result = await readAiVaultConversationInBackground({ agent: 'claude', filePath })
    expect(result.messages.map((m) => m.text)).toEqual(['message 0', 'message 1'])
  })
})
