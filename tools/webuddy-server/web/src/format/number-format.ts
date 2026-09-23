type MaybeNumber = number | null | undefined

export function formatCount(n: MaybeNumber): string {
  return n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US')
}

/** Agents that don't report usage store 0; showing "0 tokens" would read as a real measurement. */
export function formatTokens(n: MaybeNumber): string {
  return n ? formatCount(n) : '—'
}

export function formatBytes(n: MaybeNumber): string {
  if (n === null || n === undefined) {
    return '—'
  }
  if (n < 1024) {
    return `${n} B`
  }
  if (n < 1024 * 1024) {
    return `${Math.round(n / 1024)} KB`
  }
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
