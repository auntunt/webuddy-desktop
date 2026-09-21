/**
 * Webuddy agent-session record schema (v1).
 *
 * Every uploaded record answers three questions explicitly, so the server never
 * has to guess and no consumer has to re-derive provenance:
 *   - whose log  -> `actor` (person + device) and `agent` (which CLI produced it)
 *   - when       -> `session.startedAt / endedAt / localDate` plus `collectedAt`
 *   - what       -> `workspace`, `transcript`, `session` counters
 *
 * Anything a reader could otherwise infer from the upload channel (who pushed,
 * from which machine) is written into the record instead, because records get
 * copied, replayed and merged downstream.
 */

export const SCHEMA_VERSION = 'webuddy.agent-session.v1'
export const REDACTION_POLICY_VERSION = 'webuddy.redact.v1'

/**
 * How much of the transcript body leaves the machine.
 *
 * `full` is the only mode this product ships. Collection is team-management
 * data, not an opt-in: the value of a record is seeing what was actually done.
 * `metadata` survives only so a record written by an older build still
 * validates — no current code path emits it.
 */
export const CONSENT_SCOPES = {
  /** Metadata + hashes only. Legacy: accepted on read, never produced. */
  metadata: 'transcript-metadata',
  /** Metadata plus the redacted transcript body. The shipping mode. */
  full: 'transcript-full'
}

/** The scope every record is collected under. */
export const ACTIVE_CONSENT_SCOPE = CONSENT_SCOPES.full

/**
 * Known agent CLIs. `transcriptRoots` are relative to the home directory and
 * drive discovery; `id` is the stable value written into every record, so new
 * agents are added here rather than in the collectors.
 */
export const AGENTS = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    roots: ['.claude/projects'],
    // Claude Code stores one JSONL per session under a directory whose name is
    // the cwd with separators replaced. Nested dirs are normal.
    layout: 'dir-of-jsonl'
  },
  {
    id: 'codex',
    label: 'Codex',
    roots: ['.codex/sessions'],
    // Codex stores rollout-<timestamp>-<uuid>.jsonl under YYYY/MM/DD/.
    layout: 'date-tree-jsonl'
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    roots: ['.local/share/opencode'],
    layout: 'dir-of-jsonl'
  }
]

export function agentById(id) {
  return AGENTS.find((agent) => agent.id === id) ?? null
}

/**
 * Actor identity: who and where. `deviceId` is generated once per machine and
 * persisted, so a record stays attributable even if the user renames the host.
 */
export function buildActor({ config, deviceId, hostname, osUser, platform }) {
  const actor = {
    userId: config.userId ?? null,
    deviceId,
    // Why `||`: an empty string in config is "unset", not a chosen label.
    deviceLabel: config.deviceLabel || hostname,
    hostname,
    osUser,
    platform
  }
  if (!actor.userId) {
    // Why throw rather than upload anonymously: an unattributed session is not
    // company data, it's unlabelled noise. Fail loudly at the boundary.
    throw new Error(
      'actor.userId is required — set it in ~/.webuddy-agent/config.json (or WEBUDDY_USER_ID) before collecting'
    )
  }
  return actor
}

/** Local calendar date (not UTC) — reports and retention are read in local time. */
export function localDateOf(isoString, timeZoneOffsetMinutes) {
  if (!isoString) {
    return null
  }
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  // Shift the UTC instant by the local offset to read the local calendar day:
  // UTC+8 must move *later*, so the offset is added, not subtracted.
  const shifted = new Date(date.getTime() + timeZoneOffsetMinutes * 60_000)
  return shifted.toISOString().slice(0, 10)
}

export function timeZoneOffsetMinutes(now = new Date()) {
  // getTimezoneOffset() is minutes *behind* UTC (UTC+8 => -480).
  return -now.getTimezoneOffset()
}

/**
 * Normalized record. `model`/`gitBranch`/`repo` are null when the agent does not
 * expose them — null means "not reported", never "absent in reality".
 */
export function buildSessionRecord({
  actor,
  agent,
  session,
  workspace,
  transcript,
  collection,
  redaction,
  consent
}) {
  return {
    schema: SCHEMA_VERSION,
    collectedAt: collection.collectedAt,
    collector: { name: 'webuddy-agent', version: collection.collectorVersion },
    actor,
    agent,
    session,
    workspace,
    transcript,
    redaction,
    consent
  }
}

/** Shape check used before upload — a malformed record must never reach the wire. */
export function validateRecord(record) {
  const errors = []
  if (record?.schema !== SCHEMA_VERSION) {
    errors.push(`schema must be ${SCHEMA_VERSION}`)
  }
  for (const path of [
    'actor.userId',
    'actor.deviceId',
    'agent.id',
    'session.id',
    'transcript.sha256'
  ]) {
    const value = path.split('.').reduce((node, key) => node?.[key], record)
    if (typeof value !== 'string' || value.length === 0) {
      errors.push(`missing ${path}`)
    }
  }
  if (!record?.session?.startedAt) {
    errors.push('missing session.startedAt')
  }
  if (!record?.session?.localDate) {
    errors.push('missing session.localDate')
  }
  if (!Object.values(CONSENT_SCOPES).includes(record?.consent?.scope)) {
    errors.push('consent.scope must be a known scope')
  }
  return errors
}
