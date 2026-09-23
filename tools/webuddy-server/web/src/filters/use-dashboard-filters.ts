import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { toLocalIsoDate } from '../format/date-format'

export type RangeKey = '7' | '30' | '90' | 'all'

export type DashboardFilters = {
  from?: string
  to?: string
  range?: RangeKey
  group?: string
  agent?: string
  user?: string
  project?: string
  q?: string
}

export type FilterPatch = { [K in keyof DashboardFilters]?: DashboardFilters[K] | '' }

const TEXT_KEYS = ['from', 'to', 'group', 'agent', 'user', 'project', 'q'] as const
const RANGES: readonly RangeKey[] = ['7', '30', '90', 'all']

function isRange(value: string | null): value is RangeKey {
  return RANGES.some((range) => range === value)
}

export function readFilters(params: URLSearchParams): DashboardFilters {
  const filters: DashboardFilters = {}
  for (const key of TEXT_KEYS) {
    const value = params.get(key)
    if (value) {
      filters[key] = value
    }
  }
  const range = params.get('range')
  if (isRange(range)) {
    filters.range = range
  }
  return filters
}

/** Applies a patch to the URL params; other query keys are left untouched. */
export function applyFilterPatch(params: URLSearchParams, patch: FilterPatch): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const [key, value] of Object.entries(patch)) {
    if (value) {
      next.set(key, value)
    } else {
      next.delete(key)
    }
  }
  // New filters mean a new result set; staying on page 7 of the old one would show nothing.
  next.delete('offset')
  // A preset range and custom dates are two ways to say the same thing; the newest wins.
  if (patch.range) {
    next.delete('from')
    next.delete('to')
  } else if (patch.from || patch.to) {
    next.delete('range')
  }
  return next
}

/** Query for read endpoints: `range` becomes `from` (N days including today, local time). */
export function toApiQuery(filters: DashboardFilters): Record<string, string> {
  const query: Record<string, string> = {}
  for (const key of TEXT_KEYS) {
    const value = filters[key]
    if (value) {
      query[key] = value
    }
  }
  if (filters.range && filters.range !== 'all') {
    const from = new Date()
    from.setDate(from.getDate() - (Number(filters.range) - 1))
    query.from = toLocalIsoDate(from)
  }
  return query
}

export function useDashboardFilters(): {
  filters: DashboardFilters
  setFilters: (patch: FilterPatch) => void
} {
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => readFilters(params), [params])
  const setFilters = useCallback(
    (patch: FilterPatch) =>
      setParams((current) => applyFilterPatch(current, patch), { replace: true }),
    [setParams]
  )
  return { filters, setFilters }
}
