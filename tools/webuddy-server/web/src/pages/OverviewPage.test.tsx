import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, type ApiFetchOptions } from '../api/client'
import type { Me, Role } from '../api/types'
import { sessionRow } from '../overview/session-row-fixture'
import { OverviewPage } from './OverviewPage'

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn()
}))

const apiFetchMock = vi.mocked(apiFetch)

const statsGroup = (key: string, sessions: number) => ({
  key,
  sessions,
  turns: 1,
  tokens: 0,
  duration_ms: 60_000,
  first_date: '2026-09-20',
  last_date: '2026-09-20'
})

function respond(path: string, options?: ApiFetchOptions): unknown {
  switch (path) {
    case '/api/facets':
      return {
        people: [{ value: 'lina', n: 3 }],
        agents: [{ value: 'claude-code', n: 3 }],
        projects: [],
        dates: { min: '2026-09-20', max: '2026-09-20' }
      }
    case '/api/groups':
      return { groups: [] }
    case '/api/insights':
      return {
        overall: {
          sessions: 3,
          active_days: 1,
          duration_ms: 180_000,
          turns: 3,
          messages: 6,
          tokens: 0,
          projects: 1,
          clamped_sessions: 0,
          avg_sessions_per_active_day: 3,
          first_day: '2026-09-20',
          last_day: '2026-09-20'
        }
      }
    case '/api/stats': {
      const by = String(options?.query?.by)
      const keys: Record<string, string> = {
        day: '2026-09-20',
        person: 'lina',
        agent: 'claude-code',
        project: '/Users/lina/work/app'
      }
      const key = keys[by]
      return { totals: {}, groups: [statsGroup(key, 3)] }
    }
    case '/api/sessions':
      return { items: [sessionRow()], total: 1, limit: 50, offset: 0 }
    default:
      throw new Error(`unexpected ${path}`)
  }
}

function me(role: Role): Me {
  return {
    id: 'u-1',
    username: 'lina',
    display_name: '李娜',
    role,
    group_id: null,
    group_name: null
  }
}

function renderOverview(role: Role, url = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <OverviewPage me={me(role)} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function callsTo(path: string) {
  return apiFetchMock.mock.calls.filter(([p]) => p === path).map(([, options]) => options?.query)
}

beforeEach(() => {
  apiFetchMock.mockImplementation(async (path, options) => respond(path, options))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})

afterEach(() => {
  apiFetchMock.mockReset()
  vi.unstubAllGlobals()
})

describe('OverviewPage', () => {
  it('shows the per-person ranking to an admin and asks insights for everyone', async () => {
    renderOverview('admin')
    expect(await screen.findByRole('heading', { name: '按人' })).toBeInTheDocument()
    await waitFor(() => expect(callsTo('/api/insights')[0]).toMatchObject({ user: '__all__' }))
    expect(callsTo('/api/stats').map((q) => q?.by)).toEqual(
      expect.arrayContaining(['day', 'agent', 'person', 'project'])
    )
  })

  it('hides the per-person ranking from a member', async () => {
    renderOverview('member')
    expect(await screen.findByRole('heading', { name: '按 agent' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '按人' })).not.toBeInTheDocument()
    expect(callsTo('/api/stats').map((q) => q?.by)).not.toContain('person')
    expect(callsTo('/api/insights')[0]?.user).toBeUndefined()
  })

  it('narrows the person options to the picked group', async () => {
    renderOverview('admin', '/?group=g-a')
    await waitFor(() => expect(callsTo('/api/facets')).toContainEqual({ group: 'g-a' }))
    expect(callsTo('/api/facets')).not.toContainEqual(undefined)
  })

  it('filters by an agent when its ranking bar is clicked', async () => {
    renderOverview('admin')
    const bar = await screen.findByRole('button', { name: /claude-code.*3/ })
    await userEvent.setup().click(bar)
    await waitFor(() =>
      expect(callsTo('/api/sessions').at(-1)).toMatchObject({ agent: 'claude-code', offset: 0 })
    )
  })
})
