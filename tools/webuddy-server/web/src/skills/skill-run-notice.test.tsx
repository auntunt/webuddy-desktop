import { describe, expect, it } from 'vitest'
import { formatDateTime } from '../format/date-format'
import { skillRunNotice } from './skill-run-notice'

const finishedAt = '2026-09-21T00:10:00.000Z'

describe('skillRunNotice', () => {
  it('stays silent when there is no run or the last run succeeded', () => {
    expect(skillRunNotice(null)).toBeNull()
    expect(skillRunNotice(undefined)).toBeNull()
    expect(skillRunNotice({ status: 'ok', finishedAt, extracted: 2, error: null })).toBeNull()
  })

  it('explains an empty or unparseable run with its time', () => {
    const when = formatDateTime(finishedAt)
    expect(skillRunNotice({ status: 'empty', finishedAt, extracted: 0, error: null })).toEqual({
      tone: 'info',
      text: `最近一次提炼（${when}）：没有提炼出新内容`
    })
    expect(
      skillRunNotice({ status: 'parse-failed', finishedAt, extracted: 0, error: null })?.text
    ).toBe(`最近一次提炼（${when}）：模型回复无法解析`)
  })

  it('shows the error of a failed call', () => {
    expect(
      skillRunNotice({
        status: 'error',
        finishedAt,
        extracted: 0,
        error: 'This operation was aborted'
      })
    ).toEqual({
      tone: 'bad',
      text: `最近一次提炼（${formatDateTime(finishedAt)}）：调用失败：This operation was aborted`
    })
  })
})
