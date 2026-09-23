import type { SessionListItem } from '../api/session-types'

/** Test fixture: a list row with realistic values. */
export function sessionRow(overrides: Partial<SessionListItem> = {}): SessionListItem {
  return {
    dedupe_key: 'dev-1::claude-code::s1::/Users/lina/.claude/projects/x.jsonl',
    user_id: 'lina',
    device_label: 'MacBook',
    agent_id: 'claude-code',
    agent_label: 'Claude Code',
    agent_model: 'opus',
    agent_version: '1.0.0',
    session_id: 's1',
    local_date: '2026-09-20',
    started_at: '2026-09-20T01:00:00.000Z',
    ended_at: '2026-09-20T02:30:00.000Z',
    duration_ms: 90 * 60_000,
    turn_count: 12,
    message_count: 30,
    tokens_total: 0,
    cwd: '/Users/lina/work/webuddy-desktop',
    branch: 'main',
    transcript_bytes: 2048,
    transcript_sha256: 'a'.repeat(64),
    consent_scope: 'transcript-full',
    redaction_rules: '',
    transcript_truncated: 0,
    received_at: '2026-09-20T03:00:00.000Z',
    ...overrides
  }
}
