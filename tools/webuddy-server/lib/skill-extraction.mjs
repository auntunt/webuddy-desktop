/**
 * 从个人日志里提炼可复用 skill。
 *
 * 和「工作分析」分开：分析回答"这段时间干了什么"，提炼回答"这里面有什么值得别人
 * 复用的做法"。所以素材取舍不同 —— 提炼更需要跨会话的重复模式，而不是当天的量。
 *
 * 同样是"没新数据就不跑"：一人一份水位线，某个人没有新会话就不重新提炼他。
 */

import { askModel, llmReady } from './llm.mjs'

const SYSTEM = [
  '你是研发方法论的提炼者。从给定的开发会话记录里，找出**可被别人复用**的具体做法。',
  '只写有证据支撑的，不要写"要提高效率"这类空话。每条 skill 必须能在给定记录里找到出处。',
  '严格输出 JSON 数组，不要任何解释文字。每个元素：',
  '{"title":"简短标题","summary":"一句话说明","tags":["标签"],"body":"markdown 正文，含触发场景、具体步骤、注意事项","evidence":"来自哪次会话/哪个项目的依据"}',
  '最多 8 条。宁少勿滥 —— 没有值得提炼的就返回 []。'
].join('\n')

function watermarkFor(db, userId) {
  return db
    .prepare("SELECT COALESCE(MAX(received_at), '') AS w FROM sessions WHERE user_id = ?")
    .get(userId).w
}

function material(db, userId, since, limit) {
  const rows = db
    .prepare(`SELECT local_date, agent_id, cwd, turn_count, message_count, branch
              FROM sessions WHERE user_id = ? AND received_at > ?
              ORDER BY received_at DESC LIMIT ?`)
    .all(userId, since ?? '', limit)
  const projects = db
    .prepare(`SELECT cwd, COUNT(*) AS sessions FROM sessions WHERE user_id = ?
              GROUP BY cwd ORDER BY sessions DESC LIMIT 15`)
    .all(userId)
  return { rows, projects, excerpts: excerpts(db, userId, since, limit) }
}

/**
 * 会话正文片段。
 *
 * Why 必须有：只给元数据（日期、路径、轮次）的话，"提炼可复用做法"是无解的 ——
 * 模型看不到任何具体动作，只能返回空。所以按会话取样，逐条截断，并设总量上限，
 * 让 token 花在"有内容"上而不是把整库塞进上下文。
 */
function excerpts(db, userId, since, sessions, perSession = 2500, totalCap = 40000) {
  const rows = db
    .prepare(`SELECT local_date, agent_id, cwd, transcript_body FROM sessions
              WHERE user_id = ? AND received_at > ? AND transcript_body IS NOT NULL
              ORDER BY message_count DESC LIMIT ?`)
    .all(userId, since ?? '', sessions)
  const picked = []
  let budget = totalCap
  for (const row of rows) {
    if (budget <= 0) {
      break
    }
    const take = Math.min(perSession, budget)
    const text = String(row.transcript_body).slice(0, take)
    // 太大的一行（比如整段 JSON 在一行）也会被 slice 掉，不影响。
    picked.push({ ...row, text })
    budget -= text.length
  }
  return picked
}

function buildPrompt(userId, { rows, projects, excerpts }) {
  return [
    `开发者：${userId}`,
    '',
    '## 他的项目分布',
    ...projects.map((p) => `- ${p.cwd}：${p.sessions} 个会话`),
    '',
    '## 最近会话的元数据',
    ...rows.map(
      (r) =>
        `- ${r.local_date} ${r.agent_id} ${r.cwd} ${r.branch ?? '-'} ${r.turn_count}轮/${r.message_count}条`
    ),
    '',
    '## 会话正文片段（截断，仅供判断做法）',
    ...excerpts.map((e) => `\n### ${e.local_date} · ${e.cwd} · ${e.agent_id}\n${e.text}`),
    '',
    '请从上面的正文片段里提炼可复用的 skill。'
  ].join('\n')
}

/** 模型有时会裹上 ```json 围栏，或前后带解释文字。 */
export function parseSkillJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = (fenced ? fenced[1] : text).trim()
  const start = candidate.indexOf('[')
  const end = candidate.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) {
    return []
  }
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1))
    return Array.isArray(parsed) ? parsed.filter((s) => s && s.title && s.body) : []
  } catch {
    return []
  }
}

export function lastSkillWatermark(db, userId) {
  const row = db
    .prepare('SELECT input_watermark FROM skills WHERE user_id = ? ORDER BY id DESC LIMIT 1')
    .get(userId)
  return row?.input_watermark ?? null
}

export async function extractSkills(db, userId, env = process.env) {
  if (!llmReady(env)) {
    return { skipped: 'no-api-key' }
  }
  const current = watermarkFor(db, userId)
  const previous = lastSkillWatermark(db, userId)
  if (previous && previous === current) {
    return { skipped: 'no-new-data', userId }
  }
  const digest = material(db, userId, previous ?? '', Number(env.AI_MAX_ITEMS || 40))
  if (digest.rows.length === 0 && previous) {
    return { skipped: 'no-new-data', userId }
  }

  const result = await askModel({
    system: SYSTEM,
    prompt: buildPrompt(userId, digest),
    env
  })
  const skills = parseSkillJson(result.text)
  const createdAt = new Date().toISOString()
  const insert = db.prepare(`
    INSERT INTO skills
      (user_id, title, summary, body, tags, evidence, model, input_watermark,
       source_sessions, input_tokens, output_tokens, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  db.exec('BEGIN')
  try {
    for (const skill of skills) {
      insert.run(
        userId,
        String(skill.title),
        skill.summary ?? null,
        String(skill.body),
        JSON.stringify(skill.tags ?? []),
        skill.evidence ?? null,
        result.model,
        current,
        digest.rows.length,
        result.inputTokens,
        result.outputTokens,
        createdAt
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return {
    userId,
    model: result.model,
    extracted: skills.length,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    watermark: current
  }
}

function safeTags(raw) {
  try {
    const parsed = JSON.parse(raw ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function listSkills(db, userId) {
  return db
    .prepare(`SELECT id, user_id, title, summary, body, tags, evidence, model, source_sessions, created_at
              FROM skills WHERE user_id = ? ORDER BY id DESC`)
    .all(userId)
    .map((row) => ({ ...row, tags: safeTags(row.tags) }))
}

export function getSkill(db, id) {
  const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(Number(id))
  return row ? { ...row, tags: safeTags(row.tags) } : null
}

/** 下载格式：可以直接丢进知识库或喂给 agent 的 markdown。 */
export function skillAsMarkdown(skill) {
  return [
    `# ${skill.title}`,
    '',
    skill.summary ? `> ${skill.summary}` : '',
    `- 来源人：${skill.user_id}`,
    `- 证据：${skill.evidence ?? '—'}`,
    `- 标签：${skill.tags.length ? skill.tags.join('、') : '—'}`,
    `- 提炼时间：${skill.created_at}`,
    `- 模型：${skill.model ?? '—'}`,
    '',
    '---',
    '',
    skill.body
  ]
    .filter((line) => line !== '')
    .join('\n')
}

/** 全部 skill 打包成一份 markdown，便于整包下载。 */
export function skillsAsBundle(userId, skills) {
  return [
    `# ${userId} 的 skill 集`,
    '',
    `共 ${skills.length} 条，导出时间 ${new Date().toISOString()}`,
    '',
    ...skills.map(
      (skill) =>
        `${skillAsMarkdown({ ...skill, body: '' }).trim()}\n\n[下载单条: /api/skills/${skill.id}/download]\n\n---\n`
    )
  ].join('\n')
}

/**
 * 定时为每个有日志的人提炼。串行执行 —— 并发打模型既没必要，也更容易撞限流。
 */
export function startSkillSchedule(db, { env = process.env } = {}) {
  const intervalMs = Number(env.WEBUDDY_SKILL_MS || 6 * 60 * 60 * 1000)
  let running = false
  const tick = async () => {
    if (running) {
      return []
    }
    running = true
    const outcomes = []
    try {
      const users = db
        .prepare('SELECT user_id, COUNT(*) AS n FROM sessions GROUP BY user_id ORDER BY n DESC')
        .all()
      for (const user of users) {
        try {
          const result = await extractSkills(db, user.user_id, env)
          outcomes.push(result)
          if (!result.skipped) {
            console.log(
              `[skills] ${user.user_id}: +${result.extracted} (${result.inputTokens}+${result.outputTokens} tokens)`
            )
          }
        } catch (error) {
          console.error(`[skills] ${user.user_id} failed:`, error?.message ?? error)
        }
      }
    } finally {
      running = false
    }
    return outcomes
  }
  const timer = setInterval(() => void tick(), intervalMs)
  timer.unref?.()
  return { tick, intervalMs }
}
