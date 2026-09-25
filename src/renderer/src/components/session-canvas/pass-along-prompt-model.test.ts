import { describe, expect, it } from 'vitest'
import { PASS_ALONG_RESULT_MAX_CHARS, composePassAlongPrompt } from './pass-along-prompt-model'

describe('composePassAlongPrompt', () => {
  it('composes result and note', () => {
    expect(composePassAlongPrompt({ fromTitle: 'A', result: '完成了', note: '请复核' })).toBe(
      '来自〈A〉的结果：\n完成了\n\n附言：请复核'
    )
  })

  it('omits the note section when the note is blank', () => {
    expect(composePassAlongPrompt({ fromTitle: 'A', result: 'ok', note: '  ' })).toBe(
      '来自〈A〉的结果：\nok'
    )
  })

  it('uses a placeholder when there is no result', () => {
    expect(composePassAlongPrompt({ fromTitle: 'A', result: null, note: '' })).toBe(
      '来自〈A〉的结果：\n（暂无结果）'
    )
    expect(composePassAlongPrompt({ fromTitle: 'A', result: '   ', note: '' })).toBe(
      '来自〈A〉的结果：\n（暂无结果）'
    )
  })

  it('truncates the result to 4000 characters', () => {
    const prompt = composePassAlongPrompt({ fromTitle: 'A', result: 'x'.repeat(5000), note: '' })
    const body = prompt.slice('来自〈A〉的结果：\n'.length)
    expect(PASS_ALONG_RESULT_MAX_CHARS).toBe(4000)
    expect(body).toBe(`${'x'.repeat(4000)}…`)
  })

  it('does not split a surrogate pair when truncating', () => {
    const prompt = composePassAlongPrompt({ fromTitle: 'A', result: '😀'.repeat(4001), note: '' })
    const body = prompt.slice('来自〈A〉的结果：\n'.length)
    expect(Array.from(body)).toHaveLength(4001)
    expect(body.endsWith('😀…')).toBe(true)
  })
})
