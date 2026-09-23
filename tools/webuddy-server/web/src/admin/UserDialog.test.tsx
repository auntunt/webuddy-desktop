import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, type ApiFetchOptions } from '../api/client'
import type { AdminUser } from '../api/admin-types'
import { UserDialog } from './UserDialog'

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn()
}))

const apiFetchMock = vi.mocked(apiFetch)

const user: AdminUser = {
  id: 'u-wang',
  username: 'wang',
  display_name: '王磊',
  role: 'member',
  created_at: '2026-01-01T00:00:00.000Z',
  disabled: 0,
  session_count: 7,
  last_active: '2026-09-22',
  token_count: 1,
  group_id: 'g-1',
  group_name: '前端组'
}

const groups = [
  {
    id: 'g-1',
    name: '前端组',
    created_at: '2026-01-01T00:00:00.000Z',
    member_count: 2,
    lead_usernames: []
  }
]

function renderDialog(props: Partial<Parameters<typeof UserDialog>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <UserDialog
        open
        mode="edit"
        user={user}
        meId="u-admin"
        groups={groups}
        onClose={vi.fn()}
        {...props}
      />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  apiFetchMock.mockImplementation(async (path: string, options?: ApiFetchOptions) => {
    if (path === `/api/admin/users/${user.id}` && options?.method === 'PATCH') {
      return { user: { ...user, ...(options.body as object) } }
    }
    throw new Error(`unexpected ${path}`)
  })
})

afterEach(() => {
  apiFetchMock.mockReset()
})

describe('UserDialog', () => {
  it('sends only the fields that changed for a name-only edit', async () => {
    renderDialog()
    const ui = userEvent.setup()
    const nameInput = screen.getByLabelText('显示名')
    await ui.clear(nameInput)
    await ui.type(nameInput, '王磊磊')
    await ui.click(screen.getByRole('button', { name: '保存' }))
    expect(apiFetchMock).toHaveBeenCalledWith(
      `/api/admin/users/${user.id}`,
      expect.objectContaining({ method: 'PATCH', body: { displayName: '王磊磊' } })
    )
  })

  it('sends an empty diff when nothing changed', async () => {
    renderDialog()
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }))
    expect(apiFetchMock).toHaveBeenCalledWith(
      `/api/admin/users/${user.id}`,
      expect.objectContaining({ method: 'PATCH', body: {} })
    )
  })

  it('asks for confirmation before disabling an enabled user, and withholds the PATCH until confirmed', async () => {
    renderDialog()
    const ui = userEvent.setup()
    await ui.selectOptions(screen.getByLabelText('状态'), '停用（立即无法上传和登录）')
    await ui.click(screen.getByRole('button', { name: '保存' }))

    expect(
      await screen.findByText('确定要停用 王磊 吗？停用后无法登录和上传。')
    ).toBeInTheDocument()
    expect(apiFetchMock).not.toHaveBeenCalledWith(
      `/api/admin/users/${user.id}`,
      expect.objectContaining({ method: 'PATCH' })
    )

    await ui.click(screen.getByRole('button', { name: '确认停用' }))
    expect(apiFetchMock).toHaveBeenCalledWith(
      `/api/admin/users/${user.id}`,
      expect.objectContaining({ method: 'PATCH', body: { disabled: true } })
    )
  })

  it('cancelling the disable confirmation sends nothing', async () => {
    renderDialog()
    const ui = userEvent.setup()
    await ui.selectOptions(screen.getByLabelText('状态'), '停用（立即无法上传和登录）')
    await ui.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText('确定要停用 王磊 吗？停用后无法登录和上传。')
    await ui.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }))
    expect(apiFetchMock).not.toHaveBeenCalled()
  })

  it('does not ask for confirmation when re-enabling a disabled user', async () => {
    renderDialog({ user: { ...user, disabled: 1 } })
    const ui = userEvent.setup()
    await ui.selectOptions(screen.getByLabelText('状态'), '正常')
    await ui.click(screen.getByRole('button', { name: '保存' }))
    expect(apiFetchMock).toHaveBeenCalledWith(
      `/api/admin/users/${user.id}`,
      expect.objectContaining({ method: 'PATCH', body: { disabled: false } })
    )
  })
})
