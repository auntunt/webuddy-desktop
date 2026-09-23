const pad = (n: number) => String(n).padStart(2, '0')

export function toLocalIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** `YYYY-MM-DD` as local midnight; `new Date(text)` would parse it as UTC. */
export function parseLocalDate(text: string): Date {
  const [year, month, day] = text.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function formatDate(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '—'
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '—'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  return `${toLocalIsoDate(date)} ${time}`
}
