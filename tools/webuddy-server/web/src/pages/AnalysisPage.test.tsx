import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, type ApiFetchOptions } from '../api/client'
import type { Me, Role } from '../api/types'
import { AnalysisPage } from './AnalysisPage'

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn()
}))

const apiFetchMock = vi.mocked(apiFetch)

function me(role: Role): Me {
  return { id: 'u-1', username: 'lina', display_name: null, role, group_id: null, group_name: null }
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
  if (path === '/api/analysis/llm' && options?.method !== 'POST') {
    return options?.query?.user === '__all__'
      ? {
          model: 'gpt',
          createdAt: '2026-09-20T10:00:00.000Z',
          sessionsCovered: 12,
          inputTokens: 1000,
          outputTokens: 200,
          content: '## 概览\n\n团队本周做了很多事。'
        }
      : { content: null, hint: '还没有分析结果' }
  }
  throw new Error(`unexpected ${path}`)
}

function renderPage(role: Role, initialEntries = ['/analysis']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        <AnalysisPage me={me(role)} />
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

describe('AnalysisPage', () => {
  it('shows the empty hint when there is no content yet', async () => {
    renderPage('member')
    expect(await screen.findByText('还没有分析结果')).toBeInTheDocument()
    expect(screen.queryByLabelText('人员')).not.toBeInTheDocument()
  })

  it('renders markdown content and meta line for the selected person', async () => {
    renderPage('admin', ['/analysis?user=__all__'])
    expect(await screen.findByRole('heading', { name: '概览' })).toBeInTheDocument()
    expect(screen.getByText(/gpt · .*覆盖 12 会话/)).toBeInTheDocument()
  })

  it('ignores a stray ?user= from a previous session for a member', async () => {
    renderPage('member', ['/analysis?user=someone-else'])
    await screen.findByText('还没有分析结果')
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/analysis/llm',
      expect.objectContaining({ query: { user: 'lina' } })
    )
  })

  it('offers 全组 to an admin', async () => {
    renderPage('admin')
    await screen.findByLabelText('人员')
    expect(screen.getByRole('option', { name: '全组' })).toBeInTheDocument()
  })

  it('runs analysis and shows the skip message', async () => {
    apiFetchMock.mockImplementation(async (path, options) => {
      if (path === '/api/analysis/llm/run') {
        return { skipped: 'no-new-data' }
      }
      return respond(path, options)
    })
    renderPage('member')
    await screen.findByText('还没有分析结果')
    await userEvent.setup().click(screen.getByRole('button', { name: /立即分析/ }))
    expect(await screen.findByText('跳过：没有新数据，本次跳过')).toBeInTheDocument()
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/analysis/llm/run',
        expect.objectContaining({ method: 'POST', query: { user: 'lina' } })
      )
    )
  })
})
