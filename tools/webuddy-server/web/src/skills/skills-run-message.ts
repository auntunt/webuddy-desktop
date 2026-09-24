import type { ExtractSkillsResult } from '../api/skill-types'
import { formatTokens } from '../format/number-format'

const SKIP_LABELS: Record<string, string> = {
  'no-new-data': '没有新数据，本次跳过',
  'no-api-key': '未配置模型',
  'in-progress': '已有一次提炼在进行中'
}

/** Turns an extract-skills result into the one-line status message shown under the buttons. */
export function skillsRunMessage(result: ExtractSkillsResult): string {
  if ('skipped' in result) {
    return `跳过：${SKIP_LABELS[result.skipped] ?? result.skipped}`
  }
  const tokens = `（${formatTokens(result.inputTokens)}+${formatTokens(result.outputTokens)} tokens）`
  if (result.status === 'parse-failed') {
    return `模型回复无法解析${tokens}`
  }
  if (result.status === 'empty') {
    return `没有提炼出新内容${tokens}`
  }
  return `提炼出 ${result.extracted} 条${result.salvaged ? '，回复被截断' : ''}${tokens}`
}
