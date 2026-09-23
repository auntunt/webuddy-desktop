import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, type ApiFetchOptions } from '../api/client'
import { GroupsPanel } from './GroupsPanel'

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn()
}))

const apiFetchMock = vi.mocked(apiFetch)

const groups = [
  {
    id: 'g-1',
    name: '前端组',
    created_at: '2026-01-01T00:00:00.000Z',
    member_count: 2,
    lead_usernames: ['lina']
  }
]

function respond(path: string, options?: ApiFetchOptions): unknown {
  if (path === '/api/admin/groups' && (options?.method ?? 'GET') === 'GET') {
    return { groups }
  }
  throw new Error(`unexpected ${path} ${JSON.stringify(options)}`)
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <GroupsPanel />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  apiFetchMock.mockImplementation(async (path, options) => respond(path, options))
})

afterEach(() => {
  apiFetchMock.mockReset()
})

describe('GroupsPanel', () => {
  it('lists groups with member count and lead usernames', async () => {
    renderPanel()
    expect(await screen.findByText('前端组')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('lina')).toBeInTheDocument()
  })

  it('shows the server error verbatim for a duplicate group name', async () => {
    apiFetchMock.mockImplementation(async (path, options) => {
      if (path === '/api/admin/groups' && options?.method === 'POST') {
        throw new Error('小组名已存在')
      }
      return respond(path, options)
    })
    renderPanel()
    await screen.findByText('前端组')
    const ui = userEvent.setup()
    await ui.click(screen.getByRole('button', { name: '新建小组' }))
    const dialog = screen.getByRole('dialog')
    await ui.type(within(dialog).getByPlaceholderText('例如 前端组'), '前端组')
    await ui.click(within(dialog).getByRole('button', { name: '创建' }))
    expect(await within(dialog).findByText('小组名已存在')).toBeInTheDocument()
  })

  it('requires a second confirmation before deleting a group, warning members will be ungrouped', async () => {
    apiFetchMock.mockImplementation(async (path, options) => {
      if (path === '/api/admin/groups/g-1' && options?.method === 'DELETE') {
        return { ok: true }
      }
      return respond(path, options)
    })
    renderPanel()
    await screen.findByText('前端组')
    const ui = userEvent.setup()
    await ui.click(screen.getByRole('button', { name: '删除' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/2 名成员会变为无组/)).toBeInTheDocument()
    expect(apiFetchMock).not.toHaveBeenCalledWith(
      '/api/admin/groups/g-1',
      expect.objectContaining({ method: 'DELETE' })
    )
    await ui.click(within(dialog).getByRole('button', { name: '确认删除' }))
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/admin/groups/g-1',
      expect.objectContaining({ method: 'DELETE' })
    )
  })
})
