/**
 * 个人工作情况分析。
 *
 * 只基于已采集的会话记录统计：不猜测、不补全，缺数据的地方如实空着。
 * 一律按 localDate（本地日历日）聚合 —— 用 UTC 会把跨零点的工作算到前一天。
 */

const DAY = 'local_date'

/**
 * 单个会话最多计入 12 小时。
 *
 * Why: 会话文件是 append-only 的。一个 2 月开始、今天又被追加的文件，首尾时间差
 * 是几十天 —— 那不是工作时长。不封顶就会出现「日均 79 小时」这种数字，看到的人
 * 会立刻不信任整套统计。被封顶的条数单独报出来，不假装不存在。
 */
const MAX_SESSION_MS = 12 * 60 * 60 * 1000
const ACTIVE_MS = `MIN(COALESCE(duration_ms, 0), ${MAX_SESSION_MS})`
const CLAMP_COUNT = `SUM(CASE WHEN COALESCE(duration_ms, 0) > ${MAX_SESSION_MS} THEN 1 ELSE 0 END)`

export function workSummary(db, ownerId) {
  const scope = ownerId ? 'WHERE user_id = ?' : ''
  const args = ownerId ? [ownerId] : []

  const overall = db
    .prepare(`
    SELECT COUNT(*) AS sessions,
           COUNT(DISTINCT ${DAY}) AS active_days,
           MIN(${DAY}) AS first_day,
           MAX(${DAY}) AS last_day,
           COALESCE(SUM(${ACTIVE_MS}), 0) AS duration_ms,
           COALESCE(SUM(turn_count), 0) AS turns,
           COALESCE(SUM(message_count), 0) AS messages,
           COALESCE(SUM(tokens_total), 0) AS tokens,
           COUNT(DISTINCT cwd) AS projects,
           COALESCE(${CLAMP_COUNT}, 0) AS clamped_sessions,
           COALESCE(MAX(duration_ms), 0) AS longest_raw_ms
    FROM sessions ${scope}
  `)
    .get(...args)

  // 近 14 天：没数据的天由前端补零，否则趋势线会骗人。
  const days = db
    .prepare(`
    SELECT ${DAY} AS day,
           COUNT(*) AS sessions,
           COALESCE(SUM(${ACTIVE_MS}), 0) AS duration_ms,
           COALESCE(SUM(turn_count), 0) AS turns,
           COUNT(DISTINCT cwd) AS projects
    FROM sessions ${scope}
    GROUP BY ${DAY} ORDER BY ${DAY} DESC LIMIT 14
  `)
    .all(...args)

  const busiest = db
    .prepare(`
    SELECT ${DAY} AS day, COALESCE(SUM(${ACTIVE_MS}), 0) AS duration_ms, COUNT(*) AS sessions
    FROM sessions ${scope}
    GROUP BY ${DAY} ORDER BY duration_ms DESC LIMIT 3
  `)
    .all(...args)

  const byProject = db
    .prepare(`
    SELECT cwd AS project,
           COUNT(*) AS sessions,
           COALESCE(SUM(${ACTIVE_MS}), 0) AS duration_ms,
           MAX(${DAY}) AS last_day
    FROM sessions ${scope}
    GROUP BY cwd ORDER BY duration_ms DESC LIMIT 12
  `)
    .all(...args)

  const byAgent = db
    .prepare(`
    SELECT agent_id, agent_label, COUNT(*) AS sessions,
           COALESCE(SUM(${ACTIVE_MS}), 0) AS duration_ms,
           COALESCE(SUM(tokens_total), 0) AS tokens
    FROM sessions ${scope}
    GROUP BY agent_id ORDER BY sessions DESC
  `)
    .all(...args)

  const models = db
    .prepare(`
    SELECT agent_model AS model, COUNT(*) AS sessions
    FROM sessions ${scope ? `${scope} AND` : 'WHERE'} agent_model IS NOT NULL
    GROUP BY agent_model ORDER BY sessions DESC LIMIT 8
  `)
    .all(...args)

  const spanDays =
    overall.first_day && overall.last_day
      ? Math.round((Date.parse(overall.last_day) - Date.parse(overall.first_day)) / 86400000) + 1
      : 0

  return {
    overall: {
      ...overall,
      span_days: spanDays,
      // 平均按活跃天算，不按自然天 —— 周末不干活不代表效率低。
      avg_duration_per_active_day: overall.active_days
        ? Math.round(overall.duration_ms / overall.active_days)
        : 0,
      avg_sessions_per_active_day: overall.active_days
        ? Math.round((overall.sessions / overall.active_days) * 10) / 10
        : 0,
      // 明确标记：这个时长里有被封顶的会话，不是精确值。
      duration_is_clamped: overall.clamped_sessions > 0
    },
    recent_days: [...days].toReversed(),
    busiest_days: busiest,
    by_project: byProject,
    by_agent: byAgent,
    by_model: models
  }
}
