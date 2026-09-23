import type { ExtractSkillsResult } from '../api/skill-types'
import { formatTokens } from '../format/number-format'

const SKIP_LABELS: Record<string, string> = {
  'no-new-data': '没有新数据，本次跳过',
  'no-api-key': '未配置模型'
}

/** Turns an extract-skills result into the one-line status message shown under the buttons. */
export function skillsRunMessage(result: ExtractSkillsResult): string {
  if ('skipped' in result) {
    return `跳过：${SKIP_LABELS[result.skipped] ?? result.skipped}`
  }
  return `提炼出 ${result.extracted} 条（${formatTokens(result.inputTokens)}+${formatTokens(result.outputTokens)} tokens）`
}
