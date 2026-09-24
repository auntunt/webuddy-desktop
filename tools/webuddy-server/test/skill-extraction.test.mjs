import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { extractSkills } from '../lib/skill-extraction.mjs'
import { lastSkillWatermark, latestSkillRun } from '../lib/skill-runs.mjs'
import { LLM_ENV, fakeReply as reply, insertSession, openTempDb } from './skill-fixtures.mjs'

const skill = (title) => ({ title, summary: 's', tags: [], body: `## ${title}`, evidence: 'e' })

let db
beforeEach(() => {
  db = openTempDb()
  insertSession(db, { receivedAt: '2026-09-20T01:00:00Z' })
})
afterEach(() => {
  mock.restoreAll()
  db.close()
})

const runs = () => db.prepare('SELECT * FROM skill_runs ORDER BY id').all()

describe('extractSkills', () => {
  it('salvages complete skills from a truncated reply and records an ok run', async () => {
    const fetchMock = reply(
      `[${JSON.stringify(skill('A'))},${JSON.stringify(skill('B'))},{"title":"C","bo`,
      'length'
    )
    const result = await extractSkills(db, 'lina', LLM_ENV)
    assert.equal(result.extracted, 2)
    assert.equal(result.status, 'ok')
    const [run] = runs()
    assert.equal(run.status, 'ok')
    assert.equal(run.extracted, 2)
    assert.equal(run.finish_reason, 'length')
    assert.equal(run.input_watermark, '2026-09-20T01:00:00Z')
    assert.equal(run.input_tokens, 100)
    assert.equal(JSON.parse(fetchMock.mock.calls[0].arguments[1].body).max_tokens, 8000)
    assert.deepEqual((await extractSkills(db, 'lina', LLM_ENV)).skipped, 'no-new-data')
    assert.equal(fetchMock.mock.callCount(), 1)
  })

  it('records parse-failed with the raw reply and does not pay again for the same data', async () => {
    const fetchMock = reply('x'.repeat(5000))
    const result = await extractSkills(db, 'lina', LLM_ENV)
    assert.equal(result.status, 'parse-failed')
    const [run] = runs()
    assert.equal(run.status, 'parse-failed')
    assert.equal(run.raw_excerpt.length, 4000)
    assert.equal(lastSkillWatermark(db, 'lina'), '2026-09-20T01:00:00Z')
    await extractSkills(db, 'lina', LLM_ENV)
    assert.equal(fetchMock.mock.callCount(), 1)
  })

  it('records empty when the model returns []', async () => {
    reply('[]')
    assert.equal((await extractSkills(db, 'lina', LLM_ENV)).status, 'empty')
    assert.equal(runs()[0].status, 'empty')
  })

  it('records an error run without advancing the watermark, so the next tick retries', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => {
      throw new Error('gateway timeout')
    })
    await assert.rejects(extractSkills(db, 'lina', LLM_ENV), /gateway timeout/)
    const [run] = runs()
    assert.equal(run.status, 'error')
    assert.match(run.error, /gateway timeout/)
    assert.equal(run.input_watermark, null)
    assert.equal(lastSkillWatermark(db, 'lina'), null)
    await assert.rejects(extractSkills(db, 'lina', LLM_ENV))
    assert.equal(fetchMock.mock.callCount(), 2)
  })

  it('sends readable conversation text and asks for at most 5 compact skills', async () => {
    insertSession(db, {
      receivedAt: '2026-09-20T02:00:00Z',
      body: [
        JSON.stringify({ type: 'summary', summary: 'METADATA-NOISE' }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: '把重试改成指数退避' } })
      ].join('\n')
    })
    const fetchMock = reply('[]')
    await extractSkills(db, 'lina', LLM_ENV)
    const sent = JSON.parse(fetchMock.mock.calls[0].arguments[1].body)
    const prompt = sent.messages[1].content
    assert.match(prompt, /用户：把重试改成指数退避/)
    assert.doesNotMatch(prompt, /METADATA-NOISE/)
    assert.match(sent.messages[0].content, /最多 5 条/)
  })

  it('prefers the stored conversation over the raw transcript when both exist', async () => {
    insertSession(db, {
      receivedAt: '2026-09-20T03:00:00Z',
      body: JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'RAW-TRANSCRIPT-TEXT' }
      }),
      conversationJson: JSON.stringify({
        messages: [{ role: 'user', text: 'CONVERSATION-TEXT', timestamp: null }],
        truncated: false
      })
    })
    const fetchMock = reply('[]')
    await extractSkills(db, 'lina', LLM_ENV)
    const prompt = JSON.parse(fetchMock.mock.calls[0].arguments[1].body).messages[1].content
    assert.match(prompt, /用户：CONVERSATION-TEXT/)
    assert.doesNotMatch(prompt, /RAW-TRANSCRIPT-TEXT/)
  })
})

describe('extractSkills concurrency', () => {
  it('skips a second extraction for the same user while one is in flight', async () => {
    let release
    const fetchMock = mock.method(
      globalThis,
      'fetch',
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve(
              new Response(JSON.stringify({ choices: [{ message: { content: '[]' } }], usage: {} }))
            )
        })
    )
    const first = extractSkills(db, 'lina', LLM_ENV)
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(await extractSkills(db, 'lina', LLM_ENV), {
      skipped: 'in-progress',
      userId: 'lina'
    })
    release()
    assert.equal((await first).status, 'empty')
    assert.equal(fetchMock.mock.callCount(), 1)
    insertSession(db, { receivedAt: '2026-09-22T00:00:00Z' })
    const again = extractSkills(db, 'lina', LLM_ENV)
    await new Promise((resolve) => setImmediate(resolve))
    release()
    assert.equal((await again).status, 'empty')
  })
})

describe('skill run bookkeeping', () => {
  it('falls back to the skills table watermark for data extracted before skill_runs existed', () => {
    db.prepare(`INSERT INTO skills (user_id, title, body, input_watermark, created_at)
      VALUES ('lina', 't', 'b', '2026-09-19T00:00:00Z', '2026-09-19T00:00:00Z')`).run()
    assert.equal(lastSkillWatermark(db, 'lina'), '2026-09-19T00:00:00Z')
  })

  it('exposes the latest run per user', async () => {
    assert.equal(latestSkillRun(db, 'lina'), null)
    reply('nope')
    await extractSkills(db, 'lina', LLM_ENV)
    const run = latestSkillRun(db, 'lina')
    assert.equal(run.status, 'parse-failed')
    assert.equal(run.extracted, 0)
    assert.equal(run.error, null)
    assert.ok(run.finishedAt)
  })
})
