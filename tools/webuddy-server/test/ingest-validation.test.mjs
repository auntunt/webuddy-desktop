import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeConversation } from '../lib/ingest-validation.mjs'

describe('sanitizeConversation', () => {
  it('keeps only {role, text, timestamp} messages with the right types', () => {
    const kept = sanitizeConversation([
      { role: 'user', text: 'hi', timestamp: '2026-09-20T10:00:00Z', extra: 'x' },
      { role: 'assistant', text: 'yo', timestamp: null },
      { role: 'assistant', text: 'no ts' },
      { role: 'user', text: 42 },
      { role: 7, text: 'bad role' },
      { role: 'user', text: 'bad ts', timestamp: 123 },
      null,
      'string'
    ])
    assert.deepEqual(kept, [
      { role: 'user', text: 'hi', timestamp: '2026-09-20T10:00:00Z' },
      { role: 'assistant', text: 'yo', timestamp: null },
      { role: 'assistant', text: 'no ts', timestamp: null }
    ])
  })

  it('returns null for a non-array or an oversized conversation', () => {
    assert.equal(sanitizeConversation({ role: 'user' }), null)
    const big = [{ role: 'user', text: 'x'.repeat(3 * 1024 * 1024), timestamp: null }]
    assert.equal(sanitizeConversation(big), null)
  })
})
