/** Last two path segments: enough to tell `apps/web` from `packages/web`. */
export function shortPath(path: string | null | undefined): string {
  return (
    String(path ?? '')
      .replace(/^~/, '')
      .split(/[\\/]/)
      .filter(Boolean)
      .slice(-2)
      .join('/') || '—'
  )
}
