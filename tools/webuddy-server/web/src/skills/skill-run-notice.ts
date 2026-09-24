import type { SkillRun } from '../api/skill-types'
import { formatDateTime } from '../format/date-format'

export type SkillRunNotice = { tone: 'info' | 'bad'; text: string }

/** Why the latest extraction produced nothing; null when there is nothing to explain. */
export function skillRunNotice(run: SkillRun | null | undefined): SkillRunNotice | null {
  if (!run || run.status === 'ok') {
    return null
  }
  const prefix = `最近一次提炼（${formatDateTime(run.finishedAt)}）：`
  if (run.status === 'error') {
    return { tone: 'bad', text: `${prefix}调用失败：${run.error ?? '未知错误'}` }
  }
  const reason = run.status === 'empty' ? '没有提炼出新内容' : '模型回复无法解析'
  return { tone: 'info', text: `${prefix}${reason}` }
}
