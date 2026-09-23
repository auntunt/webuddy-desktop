import { describe, expect, it } from 'vitest'
import { fillDailySeries } from './daily-series'

const group = (key: string, sessions: number) => ({
  key,
  sessions,
  turns: 0,
  tokens: 0,
  duration_ms: sessions * 60_000,
  first_date: key,
  last_date: key
})

describe('fillDailySeries', () => {
  it('fills missing days with zeros between the data bounds', () => {
    const series = fillDailySeries([group('2026-09-01', 2), group('2026-09-04', 1)])
    expect(series.map((d) => [d.day, d.sessions])).toEqual([
      ['2026-09-01', 2],
      ['2026-09-02', 0],
      ['2026-09-03', 0],
      ['2026-09-04', 1]
    ])
  })

  it('stretches to explicit bounds, across a month end', () => {
    const series = fillDailySeries([group('2026-09-01', 3)], '2026-08-30', '2026-09-02')
    expect(series.map((d) => d.day)).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02'
    ])
    expect(series[2]).toMatchObject({ sessions: 3, duration_ms: 180_000 })
  })

  it('returns nothing when there is no data and no bounds', () => {
    expect(fillDailySeries([])).toEqual([])
  })
})
