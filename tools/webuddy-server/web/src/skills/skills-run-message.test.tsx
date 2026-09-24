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

  const base = { userId: 'lina', model: 'gpt', inputTokens: 500, outputTokens: 90 }

  it('says the reply could not be parsed instead of 提炼出 0 条', () => {
    expect(
      skillsRunMessage({
        ...base,
        status: 'parse-failed',
        extracted: 0,
        salvaged: false,
        finishReason: 'length'
      })
    ).toBe('模型回复无法解析（500+90 tokens）')
  })

  it('says nothing new was extracted for an empty run', () => {
    expect(
      skillsRunMessage({
        ...base,
        status: 'empty',
        extracted: 0,
        salvaged: false,
        finishReason: 'stop'
      })
    ).toBe('没有提炼出新内容（500+90 tokens）')
  })

  it('notes skills salvaged from a truncated reply', () => {
    expect(
      skillsRunMessage({
        ...base,
        status: 'ok',
        extracted: 2,
        salvaged: true,
        finishReason: 'length'
      })
    ).toBe('提炼出 2 条，回复被截断（500+90 tokens）')
  })

  it('reports an extraction already in progress', () => {
    expect(skillsRunMessage({ skipped: 'in-progress' })).toBe('跳过：已有一次提炼在进行中')
  })
})
