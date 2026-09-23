import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, type ApiFetchOptions } from '../api/client'
import type { Me, Role } from '../api/types'
import { SkillsPage } from './SkillsPage'

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn()
}))

const apiFetchMock = vi.mocked(apiFetch)

function me(role: Role): Me {
  return { id: 'u-1', username: 'lina', display_name: null, role, group_id: null, group_name: null }
}

const skill = {
  id: 7,
  user_id: 'lina',
  title: '并行改造迁移脚本',
  summary: '先跑干跑再改写',
  body: '## 步骤\n\n1. dry-run\n2. 应用',
  tags: ['迁移'],
  evidence: '会话 abc',
  model: 'gpt',
  source_sessions: 4,
  created_at: '2026-09-20T10:00:00.000Z'
}

function respond(path: string, options?: ApiFetchOptions): unknown {
  if (path === '/api/facets') {
    return {
      people: [{ value: 'lina', n: 3 }],
      agents: [],
      projects: [],
      dates: { min: null, max: null }
    }
  }
  if (path === '/api/skills') {
    return { userId: String(options?.query?.user), items: [skill] }
  }
  throw new Error(`unexpected ${path}`)
}

function renderPage(role: Role, initialEntries = ['/skills']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        <SkillsPage me={me(role)} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  apiFetchMock.mockImplementation(async (path, options) => respond(path, options))
})

afterEach(() => {
  apiFetchMock.mockReset()
})

describe('SkillsPage', () => {
  it('lists a skill and expands its markdown body on demand', async () => {
    renderPage('member')
    expect(await screen.findByText('并行改造迁移脚本')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '步骤' })).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: /展开正文/ }))
    expect(screen.getByRole('heading', { name: '步骤' })).toBeInTheDocument()
  })

  it('ignores a stray ?user= from a previous session for a member', async () => {
    renderPage('member', ['/skills?user=someone-else'])
    await screen.findByText('并行改造迁移脚本')
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/skills',
      expect.objectContaining({ query: { user: 'lina' } })
    )
  })

  it('never offers 全组 to an admin here', async () => {
    renderPage('admin')
    await screen.findByLabelText('人员')
    expect(screen.queryByRole('option', { name: '全组' })).not.toBeInTheDocument()
  })

  it('shows the admin as selected even when facets have no data for them yet', async () => {
    apiFetchMock.mockImplementation(async (path, options) => {
      if (path === '/api/facets') {
        // The admin ("lina") has no skills of their own; only other people show up in facets.
        return {
          people: [{ value: 'wang', n: 3 }],
          agents: [],
          projects: [],
          dates: { min: null, max: null }
        }
      }
      return respond(path, options)
    })
    renderPage('admin')
    const select = (await screen.findByLabelText('人员')) as HTMLSelectElement
    expect(select.value).toBe('lina')
    expect(screen.getByRole('option', { name: '我（lina）' })).toBeInTheDocument()
  })

  it('extracts skills and shows the result message', async () => {
    apiFetchMock.mockImplementation(async (path, options) => {
      if (path === '/api/skills/extract') {
        return { userId: 'lina', model: 'gpt', extracted: 2, inputTokens: 10, outputTokens: 5 }
      }
      return respond(path, options)
    })
    renderPage('member')
    await screen.findByText('并行改造迁移脚本')
    await userEvent.setup().click(screen.getByRole('button', { name: /立即提炼/ }))
    expect(await screen.findByText('提炼出 2 条（10+5 tokens）')).toBeInTheDocument()
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/skills/extract',
        expect.objectContaining({ method: 'POST', query: { user: 'lina' } })
      )
    )
  })
})
