import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime, parseLocalDate, toLocalIsoDate } from './date-format'
import { formatDuration } from './duration-format'
import { formatBytes, formatCount, formatTokens } from './number-format'
import { shortPath } from './path-format'

describe('formatDuration', () => {
  it('shows hours and minutes, minutes alone, and a dash for nothing', () => {
    expect(formatDuration(3 * 3_600_000 + 25 * 60_000)).toBe('3 小时 25 分')
    expect(formatDuration(42 * 60_000)).toBe('42 分')
    expect(formatDuration(20_000)).toBe('<1 分')
    expect(formatDuration(0)).toBe('—')
    expect(formatDuration(null)).toBe('—')
  })
})

describe('number formatting', () => {
  it('formats tokens with separators and a dash for 0 or missing', () => {
    expect(formatTokens(1234567)).toBe('1,234,567')
    expect(formatTokens(0)).toBe('—')
    expect(formatTokens(null)).toBe('—')
    expect(formatTokens(undefined)).toBe('—')
  })

  it('keeps a real zero for counts', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(12000)).toBe('12,000')
    expect(formatCount(null)).toBe('—')
  })

  it('formats byte sizes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
    expect(formatBytes(null)).toBe('—')
  })
})

describe('date formatting', () => {
  it('keeps the calendar day of a date or timestamp', () => {
    expect(formatDate('2026-09-01')).toBe('2026-09-01')
    expect(formatDate('2026-09-01T10:00:00.000Z')).toBe('2026-09-01')
    expect(formatDate(null)).toBe('—')
  })

  it('renders timestamps in local time', () => {
    const iso = new Date(2026, 8, 1, 7, 5, 9).toISOString()
    expect(formatDateTime(iso)).toBe('2026-09-01 07:05:09')
    expect(formatDateTime('not a date')).toBe('not a date')
    expect(formatDateTime(null)).toBe('—')
  })

  it('round-trips local ISO dates', () => {
    expect(toLocalIsoDate(parseLocalDate('2026-03-09'))).toBe('2026-03-09')
  })
})

describe('shortPath', () => {
  it('keeps the last two segments of a project path', () => {
    expect(shortPath('/Users/lina/work/webuddy-desktop')).toBe('work/webuddy-desktop')
    expect(shortPath('~/code/app')).toBe('code/app')
    expect(shortPath('C:\\repos\\orca')).toBe('repos/orca')
    expect(shortPath('')).toBe('—')
    expect(shortPath(null)).toBe('—')
  })
})
