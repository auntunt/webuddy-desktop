export function formatDuration(ms: number | null | undefined): string {
  if (!ms) {
    return '—'
  }
  if (ms < 60_000) {
    return '<1 分'
  }
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.round((ms % 3_600_000) / 60_000)
  return hours ? `${hours} 小时 ${minutes} 分` : `${minutes} 分`
}
