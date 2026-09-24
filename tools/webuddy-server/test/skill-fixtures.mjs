/** Shared fixtures for skill-extraction tests: temp db, session rows, a fake chat-completions reply. */

import { mock } from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openDb } from '../lib/db.mjs'

export const LLM_ENV = { LLM_BASE_URL: 'https://gw.invalid/v1', LLM_API_KEY: 'k', LLM_MODEL: 'm' }

export const openTempDb = () => openDb(join(mkdtempSync(join(tmpdir(), 'wb-skills-')), 'db.sqlite'))

export function insertSession(
  db,
  {
    user = 'lina',
    receivedAt,
    body = null,
    id = receivedAt,
    conversationJson = null,
    format = 'jsonl',
    path = null
  }
) {
  db.prepare(`INSERT INTO sessions (dedupe_key, device_id, user_id, agent_id, session_id,
      local_date, cwd, turn_count, message_count, received_at, transcript_body, conversation_json,
      transcript_format, transcript_path)
    VALUES (?, 'd', ?, 'claude-code', ?, '2026-09-20', '/repo', 1, 2, ?, ?, ?, ?, ?)`).run(
    `k-${id}`,
    user,
    id,
    receivedAt,
    body,
    conversationJson,
    format,
    path
  )
}

export function fakeReply(content, finishReason = 'stop') {
  return mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content }, finish_reason: finishReason }],
          usage: { prompt_tokens: 100, completion_tokens: 50 }
        })
      )
  )
}
