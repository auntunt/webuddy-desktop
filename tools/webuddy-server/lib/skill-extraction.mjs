/**
 * 从个人日志里提炼可复用 skill。
 *
 * 和「工作分析」分开：分析回答"这段时间干了什么"，提炼回答"这里面有什么值得别人
 * 复用的做法"。所以素材取舍不同 —— 提炼更需要跨会话的重复模式，而不是当天的量。
 *
 * 同样是"没新数据就不跑"：一人一份水位线，某个人没有新会话就不重新提炼他。
 */

import { askModel, llmReady } from './llm.mjs'
import { parseConversationColumn } from './conversation-schema.mjs'
import { parseSkillReply } from './skill-json.mjs'
import { lastSkillWatermark, recordSkillRun } from './skill-runs.mjs'
import { readableTranscript } from './transcript-text.mjs'

// 显式给足：5 条 × 约 400 字的正文 + JSON 外壳；网关的推理模型也会吃掉一部分。
const SKILL_MAX_TOKENS = 8000
const CONVERSATION_FORMAT = 'webuddy.conversation.v1'

const SYSTEM = [
  '你是研发方法论的提炼者。从给定的开发会话记录里，找出**可被别人复用**的具体做法。',
  '只写有证据支撑的，不要写"要提高效率"这类空话。每条 skill 必须能在给定记录里找到出处。',
  '严格输出 JSON 数组，不要任何解释文字。每个元素：',
  '{"title":"简短标题","summary":"一句话说明","tags":["标签"],"body":"markdown 正文，含触发场景、具体步骤、注意事项","evidence":"来自哪次会话/哪个项目的依据"}',
  '最多 5 条，每条 body 不超过 400 字，写要点不写铺垫。宁少勿滥 —— 没有值得提炼的就返回 []。'
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
 * 模型看不到任何具体动作，只能返回空。所以按会话取可读对话，逐条截断，并设总量上限，
 * 让 token 花在"有内容"上而不是把整库塞进上下文。
 */
function excerpts(db, userId, since, sessions, perSession = 3000, totalCap = 30000) {
  const rows = db
    .prepare(`SELECT local_date, agent_id, cwd, transcript_format, transcript_body, conversation_json
              FROM sessions
              WHERE user_id = ? AND received_at > ?
                AND (transcript_body IS NOT NULL OR conversation_json IS NOT NULL)
                AND COALESCE(transcript_path, '') NOT LIKE '%/subagents/%'
                AND COALESCE(transcript_path, '') NOT LIKE '%\\subagents\\%'
              ORDER BY message_count DESC LIMIT ?`)
    .all(userId, since ?? '', sessions)
  const picked = []
  let budget = totalCap
  for (const {
    transcript_format: format,
    transcript_body: body,
    conversation_json: conversationJson,
    ...row
  } of rows) {
    if (budget <= 0) {
      break
    }
    const text = readableTranscript(
      bodyFor(format, body, conversationJson),
      Math.min(perSession, budget)
    )
    if (text) {
      picked.push({ ...row, text })
      budget -= text.length
    }
  }
  return picked
}

/**
 * Raw transcripts go through readableTranscript's filters (sidechain, compact
 * summary, injected blocks); the normalized conversation skips them, so it is
 * used only when it is the sole source.
 */
function bodyFor(format, transcriptBody, conversationJson) {
  if (transcriptBody && format !== CONVERSATION_FORMAT) {
    return transcriptBody
  }
  const { conversation } = parseConversationColumn(conversationJson)
  if (Array.isArray(conversation) && conversation.length > 0) {
    return conversation.map((m) => JSON.stringify({ role: m.role, text: m.text })).join('\n')
  }
  return transcriptBody
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

function statusOf(skills) {
  if (skills === null) {
    return 'parse-failed'
  }
  return skills.length > 0 ? 'ok' : 'empty'
}

const normalizedTitle = (title) => String(title).trim().replace(/\s+/g, ' ').toLowerCase()

/** Why skip known titles: backfilled sessions re-trigger extraction over material already mined. */
function storeSkills(db, userId, skills, meta) {
  const known = new Set(
    db
      .prepare('SELECT title FROM skills WHERE user_id = ?')
      .all(userId)
      .map((row) => normalizedTitle(row.title))
  )
  const insert = db.prepare(`
    INSERT INTO skills
      (user_id, title, summary, body, tags, evidence, model, input_watermark,
       source_sessions, input_tokens, output_tokens, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const skill of skills) {
    const key = normalizedTitle(skill.title)
    if (known.has(key)) {
      continue
    }
    known.add(key)
    insert.run(
      userId,
      String(skill.title),
      skill.summary ?? null,
      String(skill.body),
      JSON.stringify(skill.tags ?? []),
      skill.evidence ?? null,
      meta.model,
      meta.watermark,
      meta.sourceSessions,
      meta.inputTokens,
      meta.outputTokens,
      meta.createdAt
    )
  }
}

// 手动 POST 和定时任务共用：同一人同时只跑一次，避免重复付费和重复入库。
const inFlight = new WeakMap()

/** 每次调模型都在 skill_runs 留一行；网络/超时失败记 error 后照常抛出。 */
export async function extractSkills(db, userId, env = process.env) {
  if (!llmReady(env)) {
    return { skipped: 'no-api-key', userId }
  }
  const running = inFlight.get(db) ?? new Set()
  inFlight.set(db, running)
  if (running.has(userId)) {
    return { skipped: 'in-progress', userId }
  }
  running.add(userId)
  try {
    return await runExtraction(db, userId, env)
  } finally {
    running.delete(userId)
  }
}

async function runExtraction(db, userId, env) {
  const current = watermarkFor(db, userId)
  const previous = lastSkillWatermark(db, userId)
  if (previous && previous === current) {
    return { skipped: 'no-new-data', userId }
  }
  const digest = material(db, userId, previous ?? '', Number(env.AI_MAX_ITEMS || 40))
  if (digest.rows.length === 0 && previous) {
    return { skipped: 'no-new-data', userId }
  }

  const startedAt = new Date().toISOString()
  let result
  try {
    result = await askModel({
      system: SYSTEM,
      prompt: buildPrompt(userId, digest),
      env,
      maxTokens: SKILL_MAX_TOKENS
    })
  } catch (error) {
    const message = String(error?.message ?? error)
    const finishedAt = new Date().toISOString()
    recordSkillRun(db, { userId, startedAt, finishedAt, status: 'error', error: message })
    throw error
  }
  const { skills, salvaged } = parseSkillReply(result.text, result.finishReason)
  const status = statusOf(skills)
  const finishedAt = new Date().toISOString()
  db.exec('BEGIN')
  try {
    storeSkills(db, userId, skills ?? [], {
      model: result.model,
      watermark: current,
      sourceSessions: digest.rows.length,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      createdAt: finishedAt
    })
    recordSkillRun(db, {
      userId,
      startedAt,
      finishedAt,
      status,
      extracted: skills?.length ?? 0,
      finishReason: result.finishReason,
      rawText: result.text,
      inputWatermark: current,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens
    })
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return {
    userId,
    status,
    model: result.model,
    extracted: skills?.length ?? 0,
    salvaged,
    finishReason: result.finishReason,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    watermark: current
  }
}
