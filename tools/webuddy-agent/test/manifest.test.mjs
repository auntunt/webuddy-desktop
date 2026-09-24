import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  home,
  config,
  SECRET,
  claudePath,
  codexPath,
  entryFor,
  writeManifest,
  outbox,
  dedupeKey,
  paths
} from '../test-fixtures/manifest-fixture.mjs'

const { scanManifest } = await import('../lib/manifest.mjs')
const { scanDiscovered } = await import('../lib/scan.mjs')
const { localDateOf } = await import('../lib/schema.mjs')

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

test('a file vanishing between stat and read counts as unreadable', async () => {
  const gone = join(home, 'vanished.jsonl')
  const manifestPath = writeManifest([
    entryFor(gone, 'codex', 'v1'),
    entryFor(codexPath, 'codex', 'codex-session-1')
  ])
  const result = await scanManifest(config, {
    manifestPath,
    homeDir: home,
    io: { stat: async () => ({ bytes: 10, mtimeMs: 1 }) }
  })
  assert.equal(result.skipped.unreadable, 1)
  assert.equal(result.emitted.length, 1)
})

test(
  'EACCES on a transcript counts as unreadable',
  { skip: process.platform === 'win32' || process.getuid?.() === 0 },
  async () => {
    const locked = join(home, 'locked.jsonl')
    writeFileSync(locked, '{}\n')
    chmodSync(locked, 0o000)
    try {
      const result = await scanManifest(config, {
        manifestPath: writeManifest([entryFor(locked, 'codex', 'l1')]),
        homeDir: home
      })
      assert.equal(result.skipped.unreadable, 1)
      assert.equal(result.emitted.length, 0)
    } finally {
      chmodSync(locked, 0o600)
    }
  }
)

test('sessions the legacy scan already sent are re-sent once to backfill the conversation', async () => {
  await scanDiscovered(config, { homeDir: home })
  rmSync(paths.outbox, { recursive: true, force: true })
  const manifestPath = writeManifest([entryFor(claudePath, 'claude-code', 'claude-session-1')])
  const first = await scanManifest(config, { manifestPath, homeDir: home })
  assert.equal(first.emitted.length, 1)
  assert.equal(outbox()[0].conversation.length, 1)
  const second = await scanManifest(config, { manifestPath, homeDir: home })
  assert.equal(second.emitted.length, 0)
  assert.equal(second.skipped.unchanged, 1)
})

test('WSL entries mask cwd and filePath through the distro home', async () => {
  const unc = '\\\\wsl.localhost\\Ubuntu\\home\\bob\\.codex\\s.jsonl'
  const manifestPath = writeManifest([
    entryFor(unc, 'codex', 'w1', {
      relPath: 'wsl:Ubuntu/.codex/s.jsonl',
      transcriptFormat: 'webuddy.conversation.v1',
      cwd: '/home/bob/proj'
    })
  ])
  const { emitted } = await scanManifest(config, { manifestPath, homeDir: home })
  assert.equal(emitted[0].workspace.cwd, '~/proj')
  assert.equal(emitted[0].transcript.path, '~\\.codex\\s.jsonl')
  assert.ok(!JSON.stringify(emitted[0]).includes('bob'))
})
