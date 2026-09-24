import { afterEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

import { askModel, llmConfig } from '../lib/llm.mjs'

const OPENAI_ENV = { LLM_BASE_URL: 'https://gw.invalid/v1', LLM_API_KEY: 'k', LLM_MODEL: 'm' }
const ANTHROPIC_ENV = { ANTHROPIC_API_KEY: 'k' }

function fakeFetch(body) {
  return mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body)))
}

afterEach(() => mock.restoreAll())

describe('llmConfig', () => {
  it('defaults max tokens to 8000 and timeout to 10 minutes', () => {
    for (const env of [OPENAI_ENV, ANTHROPIC_ENV, { OPENROUTER_API_KEY: 'k' }]) {
      const config = llmConfig(env)
      assert.equal(config.maxTokens, 8000)
      assert.equal(config.timeoutMs, 600000)
    }
  })

  it('reads AI_MAX_TOKENS and AI_TIMEOUT_MS', () => {
    const config = llmConfig({ ...OPENAI_ENV, AI_MAX_TOKENS: '1234', AI_TIMEOUT_MS: '5000' })
    assert.equal(config.maxTokens, 1234)
    assert.equal(config.timeoutMs, 5000)
  })

  it('falls back to defaults for non-numeric or non-positive values', () => {
    for (const bad of ['abc', '0', '-5', 'Infinity']) {
      const config = llmConfig({ ...OPENAI_ENV, AI_MAX_TOKENS: bad, AI_TIMEOUT_MS: bad })
      assert.equal(config.maxTokens, 8000)
      assert.equal(config.timeoutMs, 600000)
    }
  })
})

describe('askModel', () => {
  it('returns the OpenAI finish_reason and honours a per-call maxTokens', async () => {
    const fetchMock = fakeFetch({
      choices: [{ message: { content: ' hi ' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 3, completion_tokens: 4 }
    })
    const result = await askModel({ system: 's', prompt: 'p', env: OPENAI_ENV, maxTokens: 42 })
    assert.equal(result.text, 'hi')
    assert.equal(result.finishReason, 'length')
    assert.equal(result.inputTokens, 3)
    const sent = JSON.parse(fetchMock.mock.calls[0].arguments[1].body)
    assert.equal(sent.max_tokens, 42)
  })

  it('returns the Anthropic stop_reason', async () => {
    fakeFetch({
      content: [{ type: 'text', text: 'x' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 1, output_tokens: 2 }
    })
    const result = await askModel({ system: 's', prompt: 'p', env: ANTHROPIC_ENV })
    assert.equal(result.finishReason, 'max_tokens')
  })

  it('aborts after AI_TIMEOUT_MS', async () => {
    mock.method(
      globalThis,
      'fetch',
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener('abort', () => reject(new Error('aborted')))
        )
    )
    await assert.rejects(
      askModel({ system: 's', prompt: 'p', env: { ...OPENAI_ENV, AI_TIMEOUT_MS: '20' } }),
      /aborted/
    )
  })
})
