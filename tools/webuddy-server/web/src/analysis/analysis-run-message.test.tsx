import { describe, expect, it } from 'vitest'
import { analysisRunMessage } from './analysis-run-message'

describe('analysisRunMessage', () => {
  it('reports no new data', () => {
    expect(analysisRunMessage({ skipped: 'no-new-data' })).toBe('跳过：没有新数据，本次跳过')
  })

  it('reports no configured model', () => {
    expect(analysisRunMessage({ skipped: 'no-api-key' })).toBe('跳过：未配置模型')
  })

  it('reports token usage on success', () => {
    expect(
      analysisRunMessage({ model: 'gpt', inputTokens: 120, outputTokens: 45, content: 'x' })
    ).toBe('完成：120+45 tokens')
  })
})
