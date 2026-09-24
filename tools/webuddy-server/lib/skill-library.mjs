/**
 * 已提炼 skill 的读取与导出（列表、单条、markdown 下载），以及最近一次提炼的状态。
 */

import { latestSkillRun } from './skill-runs.mjs'

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

/** GET /api/skills 的响应：lastRun 让看板能说明"为什么没提炼出东西"。 */
export function skillsResponse(db, userId) {
  return { userId, items: listSkills(db, userId), lastRun: latestSkillRun(db, userId) }
}
