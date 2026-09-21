/**
 * Storage for collected agent sessions (node:sqlite — no dependencies).
 *
 * One row per session, keyed by a stable (deviceId, sessionId) pair so a machine
 * that re-uploads after an edit updates its row instead of duplicating it.
 * The transcript body is stored alongside the metadata rather than in a blob
 * store: at team scale the whole corpus is a few GB and keeping it in SQLite
 * makes every "搜索某段代码是在哪次会话里写的" query a single statement.
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  dedupe_key          TEXT PRIMARY KEY,
  device_id           TEXT NOT NULL,
  user_id             TEXT NOT NULL,
  hostname            TEXT,
  os_user             TEXT,
  platform            TEXT,
  device_label        TEXT,
  agent_id            TEXT NOT NULL,
  agent_label         TEXT,
  agent_version       TEXT,
  agent_model         TEXT,
  session_id          TEXT NOT NULL,
  started_at          TEXT,
  ended_at            TEXT,
  duration_ms         INTEGER,
  local_date          TEXT,
  turn_count          INTEGER,
  message_count       INTEGER,
  tokens_input        INTEGER,
  tokens_output       INTEGER,
  tokens_total        INTEGER,
  cwd                 TEXT,
  branch              TEXT,
  repo                TEXT,
  transcript_path     TEXT,
  transcript_bytes    INTEGER,
  transcript_sha256   TEXT,
  transcript_format   TEXT,
  consent_scope       TEXT,
  redaction_policy    TEXT,
  redaction_rules     TEXT,
  transcript_truncated INTEGER DEFAULT 0,
  collected_at        TEXT,
  received_at         TEXT,
  transcript_body     TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_date  ON sessions(local_date);
CREATE INDEX IF NOT EXISTS idx_sessions_user  ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_sessions_cwd   ON sessions(cwd);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  role          TEXT NOT NULL DEFAULT 'member',
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  disabled      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  label        TEXT,
  token_digest TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT,
  last_used_at TEXT,
  revoked_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON api_tokens(user_id);

-- 日历式待办。个人数据，跨设备同步。
-- 逐条 rev 而不是整文件覆盖：两台机器改同一天不能互相清掉。
-- conflict_of 标记被保留的"输家"版本，让人自己裁决，不静默丢弃。
CREATE TABLE IF NOT EXISTS todos (
  id          TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  notes       TEXT,
  due_date    TEXT,
  done        INTEGER NOT NULL DEFAULT 0,
  rev         INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0,
  device_id   TEXT,
  conflict_of TEXT,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_todos_due ON todos(user_id, due_date);

-- 每台设备的水位线，客户端只拉自己没见过的
CREATE TABLE IF NOT EXISTS sync_cursors (
  user_id     TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  last_rev    INTEGER NOT NULL DEFAULT 0,
  synced_at   TEXT,
  PRIMARY KEY (user_id, device_id)
);

-- LLM 分析结果。watermark 记录这次分析覆盖到的最新 received_at，
-- 下一轮比对它就能判断"有没有新数据"，没动就不花钱。
CREATE TABLE IF NOT EXISTS analyses (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           TEXT NOT NULL,
  model             TEXT,
  watermark         TEXT,
  sessions_covered  INTEGER,
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  created_at        TEXT NOT NULL,
  content           TEXT
);
CREATE INDEX IF NOT EXISTS idx_analyses_user ON analyses(user_id, id);

-- 从某人的日志里提炼出的可复用 skill。一人多份，按提炼时间留档。
-- input_watermark 记录这次提炼覆盖到的最新 received_at，用于"没新数据就不重复提炼"。
CREATE TABLE IF NOT EXISTS skills (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          TEXT NOT NULL,
  title            TEXT NOT NULL,
  summary          TEXT,
  body             TEXT NOT NULL,
  tags             TEXT,
  evidence         TEXT,
  model            TEXT,
  input_watermark  TEXT,
  source_sessions  INTEGER,
  input_tokens     INTEGER,
  output_tokens    INTEGER,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_skills_user ON skills(user_id, id);

CREATE TABLE IF NOT EXISTS ingest_batches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL,
  device_id   TEXT,
  user_id     TEXT,
  record_count INTEGER,
  rejected    INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily_rollups (
  local_date  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  sessions    INTEGER,
  turns       INTEGER,
  messages    INTEGER,
  tokens      INTEGER,
  minutes     INTEGER,
  computed_at TEXT,
  PRIMARY KEY (local_date, user_id, agent_id)
);
`

export function openDb(path) {
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(SCHEMA)
  return db
}

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
  'transcript_body'
]

function toRow(record, transcriptBody, receivedAt) {
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
    transcriptBody
  ]
}

export function upsertSessions(db, payloads, receivedAt) {
  const placeholders = COLUMNS.map(() => '?').join(', ')
  const stmt = db.prepare(
    `INSERT INTO sessions (${COLUMNS.join(', ')}) VALUES (${placeholders})
     ON CONFLICT(dedupe_key) DO UPDATE SET
       ${COLUMNS.filter((c) => c !== 'dedupe_key')
         .map((c) => `${c}=excluded.${c}`)
         .join(', ')}`
  )
  let written = 0
  db.exec('BEGIN')
  try {
    for (const payload of payloads) {
      stmt.run(...toRow(payload.record, payload.transcript ?? null, receivedAt))
      written += 1
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return written
}

export function logBatch(db, { receivedAt, deviceId, userId, recordCount, rejected }) {
  db.prepare(
    `INSERT INTO ingest_batches (received_at, device_id, user_id, record_count, rejected)
     VALUES (?, ?, ?, ?, ?)`
  ).run(receivedAt, deviceId ?? null, userId ?? null, recordCount, rejected)
}
