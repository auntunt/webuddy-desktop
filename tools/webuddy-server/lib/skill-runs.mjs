/**
 * 每次 skill 提炼尝试的留档。
 *
 * Why：以前 0 条时什么都不存 —— 没有水位线，定时任务每轮重新付费；也没有原文，
 * 没人知道为什么是 0。现在每次调模型都记一行：状态、截断原因、回复开头。
 * 只有 error（网络/超时）不推进水位线，下一轮重试；拿到回复的都算"这批数据已付过费"。
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS skill_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL,
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  status          TEXT NOT NULL,
  extracted       INTEGER NOT NULL DEFAULT 0,
  finish_reason   TEXT,
  error           TEXT,
  raw_excerpt     TEXT,
  input_watermark TEXT,
  input_tokens    INTEGER,
  output_tokens   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_skill_runs_user ON skill_runs(user_id, id);
`

export const RAW_EXCERPT_CHARS = 4000

const ensured = new WeakSet()

/** 幂等；db.mjs 已超长，所以由用到这张表的函数自己确保。 */
export function ensureSkillRunsSchema(db) {
  if (!ensured.has(db)) {
    db.exec(SCHEMA)
    ensured.add(db)
  }
}

export function recordSkillRun(db, run) {
  ensureSkillRunsSchema(db)
  return db
    .prepare(`INSERT INTO skill_runs
      (user_id, started_at, finished_at, status, extracted, finish_reason, error, raw_excerpt,
       input_watermark, input_tokens, output_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      run.userId,
      run.startedAt,
      run.finishedAt ?? null,
      run.status,
      run.extracted ?? 0,
      run.finishReason ?? null,
      run.error ?? null,
      run.rawText == null ? null : String(run.rawText).slice(0, RAW_EXCERPT_CHARS),
      run.inputWatermark ?? null,
      run.inputTokens ?? null,
      run.outputTokens ?? null
    ).lastInsertRowid
}

/** 失败的尝试不算数；没有 skill_runs 记录的老数据退回 skills 表。 */
export function lastSkillWatermark(db, userId) {
  ensureSkillRunsSchema(db)
  const run = db
    .prepare(`SELECT input_watermark FROM skill_runs
              WHERE user_id = ? AND status != 'error' AND input_watermark IS NOT NULL
              ORDER BY id DESC LIMIT 1`)
    .get(userId)
  if (run) {
    return run.input_watermark
  }
  const legacy = db
    .prepare('SELECT input_watermark FROM skills WHERE user_id = ? ORDER BY id DESC LIMIT 1')
    .get(userId)
  return legacy?.input_watermark ?? null
}

export function latestSkillRun(db, userId) {
  ensureSkillRunsSchema(db)
  const row = db
    .prepare(`SELECT status, finished_at, extracted, error FROM skill_runs
              WHERE user_id = ? ORDER BY id DESC LIMIT 1`)
    .get(userId)
  return row
    ? {
        status: row.status,
        finishedAt: row.finished_at,
        extracted: row.extracted,
        error: row.error
      }
    : null
}
