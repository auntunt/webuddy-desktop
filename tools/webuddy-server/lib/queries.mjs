/**
 * Read-side queries: filters, rollups, and the shapes the dashboard renders.
 *
 * Aggregation happens in SQL rather than in the browser so the 大屏 stays
 * responsive as the corpus grows, and so the same numbers are available to any
 * client (dashboard, export, scheduled analysis).
 */

/** Pushes `column IN (...)`; an empty list must match nothing, not everything. */
function pushIn(clauses, params, column, values) {
  if (values.length === 0) {
    clauses.push('1 = 0')
    return
  }
  clauses.push(`${column} IN (${values.map(() => '?').join(', ')})`)
  params.push(...values)
}

/**
 * Shared filter surface for every read endpoint. `visibleUsers` comes from
 * resolveVisibleUsers (null = unrestricted); `group` is a username list.
 */
export function buildWhere({ visibleUsers, user, group, agent, project, from, to, q } = {}) {
  const clauses = []
  const params = []
  // Why first and non-negotiable: no query parameter may widen the caller's scope.
  if (Array.isArray(visibleUsers)) {
    pushIn(clauses, params, 'user_id', visibleUsers)
  }
  if (user) {
    clauses.push('user_id = ?')
    params.push(user)
  }
  if (Array.isArray(group)) {
    pushIn(clauses, params, 'user_id', group)
  }
  if (agent) {
    clauses.push('agent_id = ?')
    params.push(agent)
  }
  if (project) {
    clauses.push('cwd = ?')
    params.push(project)
  }
  if (from) {
    clauses.push('local_date >= ?')
    params.push(from)
  }
  if (to) {
    clauses.push('local_date <= ?')
    params.push(to)
  }
  if (q) {
    clauses.push('(cwd LIKE ? OR branch LIKE ? OR transcript_body LIKE ?)')
    const like = `%${q}%`
    params.push(like, like, like)
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

export function totals(db, filters) {
  const { sql, params } = buildWhere(filters)
  return db
    .prepare(`
    SELECT COUNT(*) AS sessions,
           COUNT(DISTINCT user_id) AS people,
           COALESCE(SUM(turn_count), 0) AS turns,
           COALESCE(SUM(message_count), 0) AS messages,
           COALESCE(SUM(transcript_bytes), 0) AS bytes,
           COALESCE(SUM(tokens_total), 0) AS tokens,
           COALESCE(SUM(duration_ms), 0) AS duration_ms
    FROM sessions ${sql}
  `)
    .get(...params)
}

/** groupBy is a column allowlist, never interpolated user input. */
export const GROUPABLE = {
  person: 'user_id',
  agent: 'agent_id',
  day: 'local_date',
  project: 'cwd',
  branch: 'branch'
}

export function groupBy(db, group, filters, limit = 50) {
  const column = GROUPABLE[group]
  if (!column) {
    throw new Error(`unknown group: ${group}`)
  }
  const { sql, params } = buildWhere(filters)
  // Why 按天要按日期排：时间序列按"会话数"排出来是乱的，看不出节奏。
  // 其余维度是量的排行，才用 sessions DESC。
  const order = group === 'day' ? `${column} ASC` : 'sessions DESC'
  return db
    .prepare(`
    SELECT ${column} AS key,
           COUNT(*) AS sessions,
           COALESCE(SUM(turn_count), 0) AS turns,
           COALESCE(SUM(tokens_total), 0) AS tokens,
           COALESCE(SUM(duration_ms), 0) AS duration_ms,
           MIN(local_date) AS first_date,
           MAX(local_date) AS last_date
    FROM sessions ${sql}
    GROUP BY ${column}
    ORDER BY ${order}
    LIMIT ?
  `)
    .all(...params, limit)
}

const LIST_COLUMNS = `dedupe_key, user_id, device_label, agent_id, agent_label, agent_model,
  agent_version, session_id, local_date, started_at, ended_at, duration_ms,
  turn_count, message_count, tokens_total, cwd, branch, transcript_bytes,
  transcript_sha256, consent_scope, redaction_rules, transcript_truncated, received_at`

export function listSessions(db, filters, limit = 100, offset = 0) {
  const { sql, params } = buildWhere(filters)
  return db
    .prepare(`
    SELECT ${LIST_COLUMNS} FROM sessions ${sql}
    ORDER BY local_date DESC, started_at DESC
    LIMIT ? OFFSET ?
  `)
    .all(...params, limit, offset)
}

/** 分页要知道总数，否则翻页器只能瞎猜。 */
export function countSessions(db, filters) {
  const { sql, params } = buildWhere(filters)
  return db.prepare(`SELECT COUNT(*) AS n FROM sessions ${sql}`).get(...params).n
}

export function getSession(db, key) {
  return db.prepare('SELECT * FROM sessions WHERE dedupe_key = ?').get(key) ?? null
}

export function facets(db, filters = {}) {
  const { sql, params } = buildWhere(filters)
  return {
    people: db
      .prepare(
        `SELECT user_id AS value, COUNT(*) AS n FROM sessions ${sql} GROUP BY user_id ORDER BY n DESC`
      )
      .all(...params),
    agents: db
      .prepare(
        `SELECT agent_id AS value, COUNT(*) AS n FROM sessions ${sql} GROUP BY agent_id ORDER BY n DESC`
      )
      .all(...params),
    // 给项目筛选用：按最近活跃倒序 —— 顺手干活时想选的是"在用的"，不是"总量最大的"。
    projects: db
      .prepare(
        `SELECT cwd AS value, COUNT(*) AS n, MAX(local_date) AS last_day
         FROM sessions ${sql} GROUP BY cwd ORDER BY last_day DESC LIMIT 300`
      )
      .all(...params),
    dates: db
      .prepare(`SELECT MIN(local_date) AS min, MAX(local_date) AS max FROM sessions ${sql}`)
      .get(...params)
  }
}

/**
 * Recompute per-day/person/agent rollups. Idempotent, so the scheduler can run
 * it on a timer and correctness never depends on when it last ran.
 */
export function computeRollups(db) {
  db.exec('DELETE FROM daily_rollups')
  db.exec(`
    INSERT INTO daily_rollups
      (local_date, user_id, agent_id, sessions, turns, messages, tokens, minutes, computed_at)
    SELECT local_date, user_id, agent_id,
           COUNT(*), COALESCE(SUM(turn_count), 0), COALESCE(SUM(message_count), 0),
           COALESCE(SUM(tokens_total), 0), CAST(COALESCE(SUM(duration_ms), 0) / 60000 AS INTEGER),
           datetime('now')
    FROM sessions
    GROUP BY local_date, user_id, agent_id
  `)
  return db.prepare('SELECT COUNT(*) AS n FROM daily_rollups').get().n
}

export function rollups(db, filters = {}) {
  const clauses = []
  const params = []
  if (Array.isArray(filters.visibleUsers)) {
    pushIn(clauses, params, 'user_id', filters.visibleUsers)
  }
  if (filters.user) {
    clauses.push('user_id = ?')
    params.push(filters.user)
  }
  if (Array.isArray(filters.group)) {
    pushIn(clauses, params, 'user_id', filters.group)
  }
  if (filters.agent) {
    clauses.push('agent_id = ?')
    params.push(filters.agent)
  }
  const sql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  return db
    .prepare(`
    SELECT * FROM daily_rollups ${sql} ORDER BY local_date DESC, sessions DESC LIMIT 500
  `)
    .all(...params)
}

export function toCsv(rows) {
  if (rows.length === 0) {
    return ''
  }
  const headers = Object.keys(rows[0])
  const escape = (value) => {
    if (value === null || value === undefined) {
      return ''
    }
    const text = String(value)
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(','))
  ].join('\n')
}
