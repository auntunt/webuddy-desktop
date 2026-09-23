import { describe, expect, it } from 'vitest'
import { skillsRunMessage } from './skills-run-message'

describe('skillsRunMessage', () => {
  it('reports no new data', () => {
    expect(skillsRunMessage({ skipped: 'no-new-data' })).toBe('跳过：没有新数据，本次跳过')
  })

  it('reports the extracted count and tokens on success', () => {
    expect(
      skillsRunMessage({
        userId: 'lina',
        model: 'gpt',
        extracted: 3,
        inputTokens: 500,
        outputTokens: 90
      })
    ).toBe('提炼出 3 条（500+90 tokens）')
  })
})
