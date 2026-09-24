/**
 * 定时为每个有日志的人提炼 skill。串行执行 —— 并发打模型既没必要，也更容易撞限流。
 * 每个结果（含跳过和失败）都打日志：以前只打成功，0 条和失败在日志里是隐形的。
 */

import { extractSkills } from './skill-extraction.mjs'

function outcomeLine(result) {
  if (result.skipped) {
    return `[skills] ${result.userId} skipped (${result.skipped})`
  }
  const salvaged = result.salvaged ? ', salvaged' : ''
  return `[skills] ${result.userId}: ${result.status} +${result.extracted} (finish=${result.finishReason ?? '?'}${salvaged}, ${result.inputTokens}+${result.outputTokens} tokens)`
}

export function startSkillSchedule(db, { env = process.env } = {}) {
  const intervalMs = Number(env.WEBUDDY_SKILL_MS || 6 * 60 * 60 * 1000)
  // 只靠 setInterval 的话每次部署/重启都会把下一轮再推迟 6 小时。
  const startupDelayMs = Number(env.WEBUDDY_SKILL_STARTUP_MS || 60 * 1000)
  let running = false
  const tick = async () => {
    if (running) {
      console.log('[skills] previous run still in progress, tick skipped')
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
          console.log(outcomeLine({ ...result, userId: user.user_id }))
        } catch (error) {
          console.error(`[skills] ${user.user_id} failed: ${error?.message ?? error}`)
        }
      }
    } finally {
      running = false
    }
    return outcomes
  }
  const startup = setTimeout(() => void tick(), startupDelayMs)
  startup.unref?.()
  const timer = setInterval(() => void tick(), intervalMs)
  timer.unref?.()
  const stop = () => {
    clearTimeout(startup)
    clearInterval(timer)
  }
  return { tick, intervalMs, startupDelayMs, stop }
}
