/** Content-derived React keys: stable when a ring buffer drops its oldest rows, unlike indexes. */
export function withContentKeys<T>(
  items: readonly T[],
  contentKey: (item: T) => string
): { item: T; key: string }[] {
  const seen = new Map<string, number>()
  return items.map((item) => {
    const base = contentKey(item)
    const occurrence = seen.get(base) ?? 0
    seen.set(base, occurrence + 1)
    return { item, key: `${base}#${occurrence}` }
  })
}
