// Shared fixture: sets WEBUDDY_AGENT_HOME before any lib module reads it.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'

export const stateHome = mkdtempSync(join(tmpdir(), 'wba-state-'))
export const home = mkdtempSync(join(tmpdir(), 'wba-home-'))
process.env.WEBUDDY_AGENT_HOME = stateHome
export const { paths } = await import('../lib/state.mjs')

export const INDEX = join(import.meta.dirname, '..', 'index.mjs')
export const config = {
  userId: 'alice',
  deviceLabel: '',
  includeWorkspaces: [],
  excludeWorkspaces: [],
  maxTranscriptBytes: 32 * 1024 * 1024
}
export const cwd = join(home, 'proj')
export const SECRET = 'sk-abcdefghijklmnopqrstuvwxyz0123'

export const claudePath = join(home, '.claude', 'projects', '-proj', 'c1.jsonl')
export const codexPath = join(home, '.codex', 'sessions', '2026', '03', '08', 'rollout-x-cx1.jsonl')

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

export function entryFor(filePath, agentId, sessionId, extra = {}) {
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

export function writeManifest(entries) {
  const path = join(stateHome, 'manifest.jsonl')
  writeFileSync(path, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`)
  return path
}

export function outbox() {
  try {
    return readdirSync(paths.outbox)
      .filter((n) => n.endsWith('.json'))
      .map((n) => JSON.parse(readFileSync(join(paths.outbox, n), 'utf8')))
  } catch {
    return []
  }
}

export function dedupeKey(record) {
  return [record.actor.deviceId, record.agent.id, record.session.id, record.transcript.relPath]
}
