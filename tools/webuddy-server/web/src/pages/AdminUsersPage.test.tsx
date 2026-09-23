import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, type ApiFetchOptions } from '../api/client'
import type { Me } from '../api/types'
import { AdminUsersPage } from './AdminUsersPage'

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn()
}))

const apiFetchMock = vi.mocked(apiFetch)

const me: Me = {
  id: 'u-admin',
  username: 'admin',
  display_name: '管理员',
  role: 'admin',
  group_id: null,
  group_name: null
}

const users = [
  {
    id: 'u-admin',
    username: 'admin',
    display_name: '管理员',
    role: 'admin',
    created_at: '2026-01-01T00:00:00.000Z',
    disabled: 0,
    session_count: 3,
    last_active: '2026-09-20',
    token_count: 1,
    group_id: null,
    group_name: null
  },
  {
    id: 'u-lina',
    username: 'lina',
    display_name: '李娜',
    role: 'lead',
    created_at: '2026-01-01T00:00:00.000Z',
    disabled: 0,
    session_count: 12,
    last_active: '2026-09-22',
    token_count: 2,
    group_id: 'g-1',
    group_name: '前端组'
  },
  {
    id: 'u-wang',
    username: 'wang',
    display_name: '王磊',
    role: 'member',
    created_at: '2026-01-01T00:00:00.000Z',
    disabled: 1,
    session_count: 0,
    last_active: null,
    token_count: 0,
    group_id: 'g-1',
    group_name: '前端组'
  }
]

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
  if (path === '/api/admin/users') {
    return { users }
  }
  if (path === '/api/admin/groups') {
    return { groups }
  }
  if (path === '/api/admin/users/u-lina/tokens') {
    return {
      tokens: [
        {
          id: 't-1',
          label: 'dashboard',
          created_at: '2026-09-01T00:00:00.000Z',
          expires_at: null,
          last_used_at: null
        },
        {
          id: 't-2',
          label: 'collector:a1b2c3d4e5f6',
          created_at: '2026-09-01T00:00:00.000Z',
          expires_at: null,
          last_used_at: '2026-09-20T00:00:00.000Z'
        }
      ]
    }
  }
  throw new Error(`unexpected ${path} ${JSON.stringify(options)}`)
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/admin/users']}>
        <AdminUsersPage me={me} />
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

describe('AdminUsersPage', () => {
  it('lists users with role labels, group and status mapped for display', async () => {
    renderPage()
    expect(await screen.findByText('李娜')).toBeInTheDocument()
    const linaRow = screen.getByText('李娜').closest('tr') as HTMLElement
    const wangRow = screen.getByText('王磊').closest('tr') as HTMLElement
    const adminRow = screen.getByText('admin').closest('tr') as HTMLElement
    // admin's display name is also '管理员', so both cells match the role label text.
    expect(within(adminRow).getAllByText('管理员')).toHaveLength(2)
    expect(within(linaRow).getByText('组长')).toBeInTheDocument()
    expect(within(wangRow).getByText('成员')).toBeInTheDocument()
    expect(within(linaRow).getByText('前端组')).toBeInTheDocument()
    expect(within(wangRow).getByText('已停用')).toBeInTheDocument()
    expect(within(adminRow).getByText('正常')).toBeInTheDocument()
  })

  it('filters the table by username or display name', async () => {
    renderPage()
    await screen.findByText('李娜')
    await userEvent.setup().type(screen.getByLabelText('筛选用户'), '王')
    expect(screen.queryByText('李娜')).not.toBeInTheDocument()
    expect(screen.getByText('王磊')).toBeInTheDocument()
  })

  it('rejects a create-user submission with a password under 8 characters', async () => {
    renderPage()
    await screen.findByText('李娜')
    const ui = userEvent.setup()
    await ui.click(screen.getByRole('button', { name: '新建用户' }))
    const dialog = screen.getByRole('dialog')
    await ui.type(within(dialog).getByPlaceholderText('例如 liyibin'), 'newperson')
    await ui.type(within(dialog).getByPlaceholderText('至少 8 位'), 'short')
    await ui.click(within(dialog).getByRole('button', { name: '创建' }))
    expect(await within(dialog).findByText('初始密码至少 8 位')).toBeInTheDocument()
    expect(apiFetchMock).not.toHaveBeenCalledWith(
      '/api/admin/users',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('creates a user and closes the dialog on success', async () => {
    apiFetchMock.mockImplementation(async (path, options) => {
      if (path === '/api/admin/users' && options?.method === 'POST') {
        return { user: { ...users[0], id: 'u-new' } }
      }
      return respond(path, options)
    })
    renderPage()
    await screen.findByText('李娜')
    const ui = userEvent.setup()
    await ui.click(screen.getByRole('button', { name: '新建用户' }))
    const dialog = screen.getByRole('dialog')
    await ui.type(within(dialog).getByPlaceholderText('例如 liyibin'), 'newperson')
    await ui.type(within(dialog).getByPlaceholderText('至少 8 位'), 'password1')
    await ui.click(within(dialog).getByRole('button', { name: '创建' }))
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/admin/users',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          username: 'newperson',
          password: 'password1',
          role: 'member'
        })
      })
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the server error verbatim when editing would remove the last admin', async () => {
    apiFetchMock.mockImplementation(async (path, options) => {
      if (path === '/api/admin/users/u-admin' && options?.method === 'PATCH') {
        const err = new Error('至少要保留一个启用中的管理员')
        throw err
      }
      return respond(path, options)
    })
    renderPage()
    await screen.findByText('李娜')
    const ui = userEvent.setup()
    const adminRow = screen.getByText('admin').closest('tr')
    expect(adminRow).not.toBeNull()
    await ui.click(within(adminRow as HTMLElement).getByRole('button', { name: '编辑' }))
    const dialog = screen.getByRole('dialog')
    const roleSelect = within(dialog).getByLabelText('角色')
    await ui.selectOptions(roleSelect, 'member')
    await ui.click(within(dialog).getByRole('button', { name: '保存' }))
    expect(await within(dialog).findByText('至少要保留一个启用中的管理员')).toBeInTheDocument()
  })

  it('shows a collector token with a device-hint label and revokes it', async () => {
    apiFetchMock.mockImplementation(async (path, options) => {
      if (path === '/api/admin/tokens/t-2' && options?.method === 'DELETE') {
        return { revoked: true }
      }
      return respond(path, options)
    })
    renderPage()
    await screen.findByText('李娜')
    const ui = userEvent.setup()
    const linaRow = screen.getByText('李娜').closest('tr')
    await ui.click(within(linaRow as HTMLElement).getByRole('button', { name: '凭证' }))
    const dialog = screen.getByRole('dialog')
    expect(await within(dialog).findByText('采集器（设备 a1b2c3d4 前 8 位）')).toBeInTheDocument()
    const rows = within(dialog).getAllByRole('row')
    const collectorRow = rows.find((row) => row.textContent?.includes('采集器'))
    await ui.click(within(collectorRow as HTMLElement).getByRole('button', { name: '吊销' }))
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/admin/tokens/t-2',
      expect.objectContaining({ method: 'DELETE' })
    )
  })
})
