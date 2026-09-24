import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { readableTranscript } from '../lib/transcript-text.mjs'

const jsonl = (...lines) => lines.map((line) => JSON.stringify(line)).join('\n')

const claude = jsonl(
  { type: 'summary', summary: 'metadata only' },
  { type: 'user', isMeta: true, message: { role: 'user', content: 'Caveat: meta line' } },
  {
    type: 'user',
    message: {
      role: 'user',
      content: '<system-reminder>\nnoise\n</system-reminder>\n修一下登录超时'
    }
  },
  {
    type: 'user',
    message: {
      role: 'user',
      content: '<command-name>/clear</command-name>\n<command-args></command-args>'
    }
  },
  {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'secret reasoning' },
        { type: 'text', text: '先看 auth.mjs' },
        { type: 'tool_use', name: 'Read', input: { file_path: '/x' } }
      ]
    }
  },
  {
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', content: 'file dump' }] }
  }
)

const codex = jsonl(
  { type: 'session_meta', payload: { id: 's' } },
  {
    type: 'response_item',
    payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'sys' }] }
  },
  {
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: '<environment_context>cwd</environment_context>' },
        { type: 'input_text', text: '加个重试' }
      ]
    }
  },
  { type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{}' } },
  {
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: '已加上' }]
    }
  }
)

describe('readableTranscript', () => {
  it('keeps only Claude Code user/assistant prose', () => {
    assert.equal(readableTranscript(claude), '用户：修一下登录超时\n助手：先看 auth.mjs')
  })

  it('keeps only Codex user/assistant message text', () => {
    assert.equal(readableTranscript(codex), '用户：加个重试\n助手：已加上')
  })

  it('falls back to the raw slice for unknown formats', () => {
    assert.equal(readableTranscript('plain text log '.repeat(10), 20), 'plain text log plain')
  })

  it('caps the result length', () => {
    const long = jsonl(
      ...Array.from({ length: 50 }, () => ({
        type: 'user',
        message: { role: 'user', content: 'x'.repeat(200) }
      }))
    )
    assert.ok(readableTranscript(long, 1000).length <= 1000)
  })

  it('returns empty for an empty body', () => {
    assert.equal(readableTranscript(null), '')
  })
})
