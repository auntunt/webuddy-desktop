/**
 * Turns an ingest payload into a `sessions` row and upserts it.
 *
 * Split out of db.mjs (schema/open only) purely to keep that file under the
 * repo's line cap — this is all one concern (payload -> row -> upsert).
 */

import { conversationJsonOf } from './conversation-schema.mjs'

/**
 * Stable key so re-uploading a session updates its row instead of duplicating.
 *
 * Includes the transcript path on purpose: one Claude session can be split
 * across several files on disk (subagent transcripts share the parent session
 * id), and keying on the session alone made those overwrite each other. The
 * path is stable while the file grows, so a re-scan still upserts in place.
 */
export function dedupeKey(record) {
  return [
    record.actor.deviceId,
    record.agent.id,
    record.session.id,
    record.transcript?.relPath ?? record.transcript?.path ?? ''
  ].join('::')
}

const COLUMNS = [
  'dedupe_key',
  'device_id',
  'user_id',
  'hostname',
  'os_user',
  'platform',
  'device_label',
  'agent_id',
  'agent_label',
  'agent_version',
  'agent_model',
  'session_id',
  'started_at',
  'ended_at',
  'duration_ms',
  'local_date',
  'turn_count',
  'message_count',
  'tokens_input',
  'tokens_output',
  'tokens_total',
  'cwd',
  'branch',
  'repo',
  'transcript_path',
  'transcript_bytes',
  'transcript_sha256',
  'transcript_format',
  'consent_scope',
  'redaction_policy',
  'redaction_rules',
  'transcript_truncated',
  'collected_at',
  'received_at',
  'transcript_body',
  'conversation_json'
]

function toRow(payload, receivedAt) {
  const record = payload.record
  const transcriptBody = payload.transcript ?? null
  const t = record.session.tokens ?? {}
  return [
    dedupeKey(record),
    record.actor.deviceId,
    record.actor.userId,
    record.actor.hostname,
    record.actor.osUser,
    record.actor.platform,
    record.actor.deviceLabel ?? null,
    record.agent.id,
    record.agent.label,
    record.agent.version,
    record.agent.model,
    record.session.id,
    record.session.startedAt,
    record.session.endedAt,
    record.session.durationMs,
    record.session.localDate,
    record.session.turnCount,
    record.session.messageCount,
    t.input ?? null,
    t.output ?? null,
    t.total ?? null,
    record.workspace.cwd,
    record.workspace.branch,
    record.workspace.repo,
    record.transcript.path,
    record.transcript.bytes,
    record.transcript.sha256,
    record.transcript.format,
    record.consent?.scope ?? null,
    record.redaction?.policyVersion ?? null,
    (record.redaction?.rulesApplied ?? []).join(','),
    record.redaction?.transcriptTruncated ? 1 : 0,
    record.collectedAt,
    receivedAt,
    transcriptBody,
    conversationJsonOf(payload)
  ]
}

// Why COALESCE here and only here: a re-upload of the same session (e.g. a
// resend that dropped its conversation, an older collector without an agent
// version, or a manifest-based re-upload that only carries the token total)
// must not blank out what a previous upload already stored.
const COALESCE_ON_CONFLICT = new Set([
  'conversation_json',
  'agent_version',
  'tokens_input',
  'tokens_output'
])

export function upsertSessions(db, payloads, receivedAt) {
  const placeholders = COLUMNS.map(() => '?').join(', ')
  const stmt = db.prepare(
    `INSERT INTO sessions (${COLUMNS.join(', ')}) VALUES (${placeholders})
     ON CONFLICT(dedupe_key) DO UPDATE SET
       ${COLUMNS.filter((c) => c !== 'dedupe_key')
         .map((c) =>
           COALESCE_ON_CONFLICT.has(c)
             ? `${c}=COALESCE(excluded.${c}, sessions.${c})`
             : `${c}=excluded.${c}`
         )
         .join(', ')}`
  )
  let written = 0
  db.exec('BEGIN')
  try {
    for (const payload of payloads) {
      stmt.run(...toRow(payload, receivedAt))
      written += 1
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return written
}
