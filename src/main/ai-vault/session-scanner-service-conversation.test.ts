import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  AI_VAULT_SERVICE_PROTOCOL_VERSION,
  aiVaultServiceLane,
  isAiVaultServiceRequest
} from './session-scanner-service-protocol'

vi.mock('./session-parse-cache-persistence', () => ({
  flushSessionParseCachePersist: vi.fn(() => Promise.resolve()),
  initSessionParseCachePersistence: vi.fn()
}))

const sent: { type: string; id?: number; operation?: string; value?: unknown }[] = []
let root = ''

function emit(message: object): void {
  for (const listener of process.listeners('message')) {
    listener(message, undefined)
  }
}

describe('AI Vault service conversation operation', () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'orca-service-conversation-'))
    Object.defineProperty(process, 'send', {
      configurable: true,
      writable: true,
      value: (message: (typeof sent)[number]) => {
        sent.push(message)
        return true
      }
    })
    await import('./session-scanner-service-entry')
    emit({ type: 'init', protocol: AI_VAULT_SERVICE_PROTOCOL_VERSION })
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('queues behind scans on the cache lane and is a recognised request', () => {
    expect(aiVaultServiceLane('conversation')).toBe('cache')
    expect(
      isAiVaultServiceRequest({ type: 'request', id: 1, operation: 'conversation', request: {} })
    ).toBe(true)
  })

  it('answers with the normalized conversation of one transcript', async () => {
    await mkdir(join(root, 'project'), { recursive: true })
    const filePath = join(root, 'project', 'session.jsonl')
    await writeFile(
      filePath,
      [
        { type: 'user', text: 'hello service' },
        { type: 'assistant', text: 'hi back' }
      ]
        .map(({ type, text }, i) =>
          JSON.stringify({
            type,
            sessionId: 'service-conversation',
            timestamp: `2026-05-01T10:00:0${i}.000Z`,
            cwd: '/repo/app',
            message: { role: type, content: text }
          })
        )
        .join('\n')
    )

    emit({
      type: 'request',
      id: 7,
      operation: 'conversation',
      request: { agent: 'claude', filePath }
    })
    await vi.waitFor(() => expect(sent.some((message) => message.id === 7)).toBe(true))

    expect(sent.find((message) => message.id === 7)).toEqual({
      type: 'result',
      id: 7,
      operation: 'conversation',
      value: {
        messages: [
          { role: 'user', text: 'hello service', timestamp: '2026-05-01T10:00:00.000Z' },
          { role: 'assistant', text: 'hi back', timestamp: '2026-05-01T10:00:01.000Z' }
        ],
        truncated: false,
        totalMessages: 2
      }
    })
  })
})
