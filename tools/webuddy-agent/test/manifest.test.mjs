import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'

const stateHome = mkdtempSync(join(tmpdir(), 'wba-state-'))
const home = mkdtempSync(join(tmpdir(), 'wba-home-'))
process.env.WEBUDDY_AGENT_HOME = stateHome
const { scanManifest } = await import('../lib/manifest.mjs')
const { scanDiscovered } = await import('../lib/scan.mjs')
const { localDateOf } = await import('../lib/schema.mjs')
const { paths } = await import('../lib/state.mjs')

const INDEX = join(import.meta.dirname, '..', 'index.mjs')
const config = {
  userId: 'alice',
  deviceLabel: '',
  includeWorkspaces: [],
  excludeWorkspaces: [],
  maxTranscriptBytes: 32 * 1024 * 1024
}
const cwd = join(home, 'proj')
const SECRET = 'sk-abcdefghijklmnopqrstuvwxyz0123'

const claudePath = join(home, '.claude', 'projects', '-proj', 'c1.jsonl')
const codexPath = join(home, '.codex', 'sessions', '2026', '03', '08', 'rollout-x-cx1.jsonl')

function writeLines(path, entries) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`)
}

writeLines(claudePath, [
  {
    type: 'user',
    sessionId: 'claude-session-1',
    cwd,
    gitBranch: 'main',
    timestamp: '2026-03-08T01:00:00Z',
    message: { role: 'user', content: 'hi' }
  },
  {
    type: 'assistant',
    sessionId: 'claude-session-1',
    timestamp: '2026-03-08T01:05:00Z',
    message: { role: 'assistant', model: 'claude-x', content: 'hello' }
  }
])
writeLines(codexPath, [
  {
    type: 'session_meta',
    timestamp: '2026-03-08T02:00:00Z',
    payload: { id: 'codex-session-1', cwd }
  },
  {
    type: 'response_item',
    timestamp: '2026-03-08T02:01:00Z',
    payload: { type: 'message', role: 'user', content: [] }
  }
])

function entryFor(filePath, agentId, sessionId, extra = {}) {
  return {
    agentId,
    agentLabel: agentId === 'codex' ? 'Codex' : 'Claude Code',
    sessionId,
    filePath,
    relPath: relative(home, filePath),
    transcriptFormat: 'raw-file',
    startedAt: '2026-03-08T01:00:00Z',
    endedAt: '2026-03-08T01:05:00Z',
    durationMs: 300000,
    messageCount: 2,
    turnCount: 1,
    tokensTotal: 42,
    model: 'm',
    cwd,
    branch: 'main',
    localDate: '2026-03-08',
    conversation: [{ role: 'user', text: `key ${SECRET}`, timestamp: '2026-03-08T01:00:00Z' }],
    conversationTruncated: false,
    ...extra
  }
}

function writeManifest(entries) {
  const path = join(stateHome, 'manifest.jsonl')
  writeFileSync(path, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`)
  return path
}

function outbox() {
  try {
    return readdirSync(paths.outbox)
      .filter((n) => n.endsWith('.json'))
      .map((n) => JSON.parse(readFileSync(join(paths.outbox, n), 'utf8')))
  } catch {
    return []
  }
}

function dedupeKey(record) {
  return [record.actor.deviceId, record.agent.id, record.session.id, record.transcript.relPath]
}

beforeEach(() => {
  rmSync(paths.outbox, { recursive: true, force: true })
  rmSync(paths.state, { force: true })
})

test('manifest records share dedupe keys with the legacy scan (claude + codex)', async () => {
  const legacy = await scanDiscovered(config, { homeDir: home })
  const byAgent = new Map(legacy.emitted.map((r) => [r.agent.id, r]))
  assert.equal(byAgent.size, 2)
  rmSync(paths.state, { force: true })
  const manifestPath = writeManifest([
    entryFor(claudePath, 'claude-code', 'claude-session-1'),
    entryFor(codexPath, 'codex', 'codex-session-1')
  ])
  const result = await scanManifest(config, { manifestPath, homeDir: home })
  assert.equal(result.emitted.length, 2)
  for (const record of result.emitted) {
    const old = byAgent.get(record.agent.id)
    assert.deepEqual(dedupeKey(record), dedupeKey(old))
    // Raw-file transcripts keep legacy hash/size semantics.
    assert.equal(record.transcript.sha256, old.transcript.sha256)
    assert.equal(record.transcript.bytes, old.transcript.bytes)
    assert.equal(record.transcript.format, 'jsonl')
  }
})

test('no raw home path reaches the record; cwd is masked', async () => {
  const manifestPath = writeManifest([entryFor(claudePath, 'claude-code', 'claude-session-1')])
  const { emitted } = await scanManifest(config, { manifestPath, homeDir: home })
  assert.equal(emitted[0].workspace.cwd, '~/proj')
  assert.ok(!JSON.stringify(emitted[0]).includes(home))
})

test('conversation texts are redacted and carried next to the transcript', async () => {
  const manifestPath = writeManifest([entryFor(claudePath, 'claude-code', 'claude-session-1')])
  await scanManifest(config, { manifestPath, homeDir: home })
  const [payload] = outbox()
  assert.equal(payload.conversation.length, 1)
  assert.ok(!payload.conversation[0].text.includes(SECRET))
  assert.match(payload.conversation[0].text, /\[redacted:openai-key\]/)
  assert.equal(typeof payload.transcript, 'string')
  assert.equal(payload.record.transcript.conversationTruncated, false)
})

test('database rows hash the redacted conversation JSONL and skip when unchanged', async () => {
  const dbEntry = entryFor(`${home}/.local/share/opencode/opencode.db#oc-1`, 'opencode', 'oc-1', {
    relPath: '.local/share/opencode/opencode.db#oc-1',
    transcriptFormat: 'webuddy.conversation.v1',
    conversationTruncated: true
  })
  const manifestPath = writeManifest([dbEntry])
  const first = await scanManifest(config, { manifestPath, homeDir: home })
  const [payload] = outbox()
  const expected = payload.conversation.map((m) => JSON.stringify(m)).join('\n')
  assert.equal(payload.transcript, expected)
  assert.ok(!payload.transcript.includes(SECRET))
  const record = first.emitted[0]
  assert.equal(record.transcript.format, 'webuddy.conversation.v1')
  assert.equal(record.transcript.sha256, createHash('sha256').update(expected).digest('hex'))
  assert.equal(record.transcript.bytes, Buffer.byteLength(expected))
  assert.equal(record.transcript.conversationTruncated, true)
  assert.deepEqual(record.session.tokens, { input: null, output: null, total: 42 })
  assert.equal(record.agent.version, null)

  const second = await scanManifest(config, { manifestPath, homeDir: home })
  assert.equal(second.emitted.length, 0)
  assert.equal(second.skipped.unchanged, 1)
})

test('localDate follows the zone rules of the session date across DST', () => {
  // New York: EST (-5) until 2026-03-08 07:00Z, EDT (-4) until 2026-11-01 06:00Z.
  assert.equal(localDateOf('2026-03-08T04:30:00Z', 'America/New_York'), '2026-03-07')
  assert.equal(localDateOf('2026-07-01T03:30:00Z', 'America/New_York'), '2026-06-30')
  assert.equal(localDateOf('2026-11-01T04:30:00Z', 'America/New_York'), '2026-11-01')
  assert.equal(localDateOf('2026-11-02T04:30:00Z', 'America/New_York'), '2026-11-01')
})

test('invalid manifest localDate falls back to computing it', async () => {
  const manifestPath = writeManifest([
    entryFor(claudePath, 'claude-code', 'claude-session-1', { localDate: 'garbage' })
  ])
  const { emitted } = await scanManifest(config, { manifestPath, homeDir: home })
  assert.equal(emitted[0].session.localDate, localDateOf('2026-03-08T01:00:00Z'))
})

test('legacy scan outbox payload is unchanged: record + transcript only', async () => {
  await scanDiscovered(config, { homeDir: home })
  for (const payload of outbox()) {
    assert.deepEqual(Object.keys(payload).sort(), ['record', 'transcript'])
    assert.equal('conversationTruncated' in payload.record.transcript, false)
  }
})

function cli(args) {
  return spawnSync(process.execPath, [INDEX, ...args], {
    env: { ...process.env, WEBUDDY_HOME: home, WEBUDDY_USER_ID: 'alice' },
    encoding: 'utf8'
  })
}

test('cli: manifest scan exits 0; missing or malformed manifest exits non-zero', () => {
  const ok = cli([
    'scan',
    '--manifest',
    writeManifest([entryFor(codexPath, 'codex', 'codex-session-1')])
  ])
  assert.equal(ok.status, 0, ok.stderr)
  assert.equal(ok.stderr, '')
  assert.notEqual(cli(['scan', '--manifest', join(stateHome, 'nope.jsonl')]).status, 0)
  const bad = join(stateHome, 'bad.jsonl')
  writeFileSync(bad, '{not json\n')
  assert.notEqual(cli(['scan', '--manifest', bad]).status, 0)
})

test('cli: legacy discovery scan prints a deprecation notice', () => {
  const run = cli(['scan'])
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stderr, /deprecated/)
})
