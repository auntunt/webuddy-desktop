/**
 * 定时 LLM 分析。
 *
 * 两条省 token 的硬规则：
 *   1. 慢：默认 2 小时才跑一次（WEBUDDY_ANALYSIS_MS 可调）。
 *   2. 没新数据就不跑：比对 sessions 里最新的 received_at 与上次分析覆盖到的水位线，
 *      没有推进就直接跳过 —— 一天没干活却照样调用模型，纯烧钱。
 *
 * 喂给模型的是「聚合统计 + 有限的会话概要」，不是正文全文。正文已经在库里，
 * 需要深挖时再单独取，日常分析不该把几 MB 的对话反复送进上下文。
 */

import { askModel, llmReady } from './llm.mjs'
import { workSummary } from './insights.mjs'

const SYSTEM = [
  '你是研发效能分析师。只根据给定的统计数据说话，不要编造。',
  '指出投入分布、节奏变化、可能的阻塞或重复劳动，以及值得注意的异常。',
  '中文输出，markdown，控制在 400 字以内，不要客套话。'
].join('\n')

const fmtHours = (ms) => `${(Number(ms || 0) / 3600000).toFixed(1)} 小时`

/** 水位线：整库最新的接收时间。用来判断"有没有新数据"。 */
function watermark(db) {
  return db.prepare("SELECT COALESCE(MAX(received_at), '') AS w FROM sessions").get().w
}

function buildPrompt(summary, recentSessions) {
  const o = summary.overall
  const lines = [
    '## 汇总',
    `会话 ${o.sessions}，活跃 ${o.active_days} 天（跨度 ${o.span_days} 天），项目 ${o.projects} 个`,
    `累计时长 ${fmtHours(o.duration_ms)}，平均每个活跃日 ${fmtHours(o.avg_duration_per_active_day)}`,
    `人类轮次 ${o.turns}，消息 ${o.messages}`,
    o.duration_is_clamped
      ? `注意：有 ${o.clamped_sessions} 个会话因文件跨天追加导致时长失真，已按 12 小时封顶`
      : '',
    '',
    '## 按项目（前 8）',
    ...summary.by_project
      .slice(0, 8)
      .map((p) => `- ${p.project}：${fmtHours(p.duration_ms)}，${p.sessions} 个会话`),
    '',
    '## 按 agent',
    ...summary.by_agent.map(
      (a) => `- ${a.agent_id}：${a.sessions} 个会话，${fmtHours(a.duration_ms)}`
    ),
    '',
    '## 最近 14 天',
    ...summary.recent_days.map(
      (d) => `- ${d.day}：${d.sessions} 个会话，${fmtHours(d.duration_ms)}，${d.projects} 个项目`
    ),
    '',
    '## 最近的会话（仅概要，无正文）',
    ...recentSessions.map((s) => `- ${s.local_date} ${s.agent_id} ${s.cwd}（${s.turn_count} 轮）`)
  ]
  return lines.filter((line) => line !== '').join('\n')
}

/** 上次分析之后新到的会话，只取概要（正文不进上下文，省 token）。 */
function recentSessionDigest(db, ownerId, since, limit) {
  const clauses = ['received_at > ?']
  const params = [since ?? '']
  if (ownerId) {
    clauses.push('user_id = ?')
    params.push(ownerId)
  }
  params.push(limit)
  return db
    .prepare(`SELECT local_date, agent_id, cwd, turn_count FROM sessions
              WHERE ${clauses.join(' AND ')} ORDER BY received_at DESC LIMIT ?`)
    .all(...params)
}

export function lastAnalysis(db, ownerId) {
  const row = ownerId
    ? db.prepare('SELECT * FROM analyses WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(ownerId)
    : db.prepare('SELECT * FROM analyses ORDER BY id DESC LIMIT 1').get()
  return row ?? null
}

/**
 * 跑一次分析。返回 { skipped } 或 { content, tokens }。
 * ownerId 为空表示全组（管理员视角）。
 */
export async function runAnalysis(db, ownerId, env = process.env) {
  if (!llmReady(env)) {
    return { skipped: 'no-api-key' }
  }
  const current = watermark(db)
  const previous = lastAnalysis(db, ownerId)
  if (previous && previous.watermark === current) {
    // 水位线没动 = 没有任何新会话，这次不花钱。
    return { skipped: 'no-new-data', watermark: current }
  }

  const summary = workSummary(db, ownerId)
  const digest = recentSessionDigest(
    db,
    ownerId,
    previous?.watermark ?? '',
    Number(env.AI_MAX_ITEMS || 40)
  )
  const result = await askModel({
    system: SYSTEM,
    prompt: buildPrompt(summary, digest),
    env
  })

  db.prepare(`
    INSERT INTO analyses
      (user_id, model, watermark, sessions_covered, input_tokens, output_tokens, created_at, content)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ownerId ?? '__all__',
    result.model,
    current,
    summary.overall.sessions,
    result.inputTokens,
    result.outputTokens,
    new Date().toISOString(),
    result.text
  )

  return {
    watermark: current,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    content: result.text
  }
}

/**
 * 启动定时器。默认 2 小时一轮 —— 这个节奏是刻意的：分析是给人看的周内参考，
 * 不是实时告警，跑得越勤只是越贵。
 */
export function startAnalysisSchedule(db, { env = process.env, ownerId = null } = {}) {
  const intervalMs = Number(env.WEBUDDY_ANALYSIS_MS || 2 * 60 * 60 * 1000)
  let running = false
  const tick = async () => {
    if (running) {
      return
    }
    running = true
    try {
      const result = await runAnalysis(db, ownerId, env)
      if (result.skipped) {
        console.log(`[analysis] skipped (${result.skipped})`)
      } else {
        console.log(
          `[analysis] done: ${result.inputTokens}+${result.outputTokens} tokens, ${result.model}`
        )
      }
    } catch (error) {
      console.error('[analysis] failed:', error?.message ?? error)
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void tick(), intervalMs)
  timer.unref?.()
  return { tick, intervalMs }
}
