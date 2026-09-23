import type { StatsGroup } from '../api/session-types'
import { parseLocalDate, toLocalIsoDate } from '../format/date-format'

export type DailyPoint = { day: string; sessions: number; duration_ms: number }

/** Guards against a runaway loop on a malformed bound. */
const MAX_DAYS = 3660

/** Days without sessions become explicit zeros, otherwise the chart hides idle stretches. */
export function fillDailySeries(groups: StatsGroup[], start?: string, end?: string): DailyPoint[] {
  const byDay = new Map<string, StatsGroup>()
  for (const group of groups) {
    if (group.key) {
      byDay.set(group.key, group)
    }
  }
  const keys = [...byDay.keys()].sort()
  const first = start ?? keys[0]
  const last = end ?? keys.at(-1)
  if (!first || !last) {
    return []
  }
  const series: DailyPoint[] = []
  const cursor = parseLocalDate(first)
  for (let i = 0; i < MAX_DAYS; i += 1) {
    const day = toLocalIsoDate(cursor)
    if (day > last) {
      break
    }
    const group = byDay.get(day)
    series.push({ day, sessions: group?.sessions ?? 0, duration_ms: group?.duration_ms ?? 0 })
    cursor.setDate(cursor.getDate() + 1)
  }
  return series
}
