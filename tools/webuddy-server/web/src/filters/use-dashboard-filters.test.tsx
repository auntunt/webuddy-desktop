import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toApiQuery, useDashboardFilters } from './use-dashboard-filters'

function setup(initialUrl: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialUrl]}>{children}</MemoryRouter>
  )
  return renderHook(() => ({ ...useDashboardFilters(), location: useLocation() }), { wrapper })
}

describe('useDashboardFilters', () => {
  it('reads filters from the URL query', () => {
    const { result } = setup('/?range=30&group=2&agent=codex&q=deploy&other=keep')
    expect(result.current.filters).toEqual({ range: '30', group: '2', agent: 'codex', q: 'deploy' })
  })

  it('ignores an unknown range value', () => {
    const { result } = setup('/?range=12')
    expect(result.current.filters).toEqual({})
  })

  it('writes patches back to the URL and drops cleared keys', () => {
    const { result } = setup('/analysis?agent=codex&other=keep')
    act(() => result.current.setFilters({ user: 'lina', agent: undefined }))
    const params = new URLSearchParams(result.current.location.search)
    expect(result.current.location.pathname).toBe('/analysis')
    expect(params.get('user')).toBe('lina')
    expect(params.has('agent')).toBe(false)
    expect(params.get('other')).toBe('keep')
    expect(result.current.filters).toEqual({ user: 'lina' })
  })

  it('resets the list page when a filter changes', () => {
    const { result } = setup('/?agent=codex&offset=100')
    act(() => result.current.setFilters({ agent: 'claude-code' }))
    expect(new URLSearchParams(result.current.location.search).has('offset')).toBe(false)
  })

  it('choosing a range clears custom dates', () => {
    const { result } = setup('/?from=2026-01-01&to=2026-02-01')
    act(() => result.current.setFilters({ range: '7' }))
    expect(result.current.filters).toEqual({ range: '7' })
  })

  it('choosing a custom date clears the range', () => {
    const { result } = setup('/?range=90')
    act(() => result.current.setFilters({ to: '2026-09-01' }))
    expect(result.current.filters).toEqual({ to: '2026-09-01' })
  })
})

describe('toApiQuery', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('turns a range into a local-date from covering N days including today', () => {
    vi.useFakeTimers()
    // 00:30 local on the 3rd: a UTC-based conversion would land on the wrong day east of UTC.
    vi.setSystemTime(new Date(2026, 8, 3, 0, 30))
    expect(toApiQuery({ range: '7', group: '2', q: 'x' })).toEqual({
      from: '2026-08-28',
      group: '2',
      q: 'x'
    })
    expect(toApiQuery({ range: '30' })).toEqual({ from: '2026-08-05' })
  })

  it('passes custom dates through and treats "all" as unbounded', () => {
    expect(toApiQuery({ from: '2026-01-01', to: '2026-01-31', user: 'lina' })).toEqual({
      from: '2026-01-01',
      to: '2026-01-31',
      user: 'lina'
    })
    expect(toApiQuery({ range: 'all', agent: 'codex' })).toEqual({ agent: 'codex' })
  })
})
