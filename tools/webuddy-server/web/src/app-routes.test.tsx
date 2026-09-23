import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Me, Role } from './api/types'
import { AppRoutes } from './app-routes'
import { AuthProvider } from './auth/session'
import { readToken, writeToken } from './auth/token-store'

function user(role: Role): Me {
  return { id: 1, username: 'lina', display_name: '李娜', role, group_id: 3, group_name: '前端组' }
}

function stubApi(me: Me) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/auth/login') {
      const body = JSON.parse(String(init?.body))
      return body.password === 'good'
        ? Response.json({ token: 'new-token', user: me })
        : Response.json({ error: '用户名或密码不对' }, { status: 401 })
    }
    if (url === '/api/auth/me') {
      return Response.json({ user: me, tokens: [] })
    }
    return Response.json({ error: 'not found' }, { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AppRoutes', () => {
  it('sends a visitor without a token to the login page', () => {
    stubApi(user('member'))
    renderAt('/analysis')
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument()
  })

  it('shows the login error, then logs in and lands on the requested page', async () => {
    const fetchMock = stubApi(user('member'))
    renderAt('/analysis')
    const ui = userEvent.setup()
    await ui.type(screen.getByLabelText('用户名'), 'lina')
    await ui.type(screen.getByLabelText('密码'), 'bad')
    await ui.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('用户名或密码不对')

    await ui.clear(screen.getByLabelText('密码'))
    await ui.type(screen.getByLabelText('密码'), 'good')
    await ui.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByRole('heading', { name: '分析' })).toBeInTheDocument()
    expect(readToken()).toBe('new-token')
    const loginBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))
    expect(loginBody).toEqual({ username: 'lina', password: 'good', label: 'dashboard' })
  })

  it('hides admin navigation from non-admins and redirects them away from /admin/users', async () => {
    writeToken('tok')
    stubApi(user('lead'))
    renderAt('/admin/users')
    expect(await screen.findByRole('heading', { name: '总览' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '用户与小组' })).not.toBeInTheDocument()
    expect(screen.getByText('组长 · 前端组')).toBeInTheDocument()
  })

  it('lets admins reach /admin/users', async () => {
    writeToken('tok')
    stubApi(user('admin'))
    renderAt('/admin/users')
    expect(await screen.findByRole('heading', { name: '用户与小组' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '用户与小组' })).toBeInTheDocument()
  })

  it('logging out clears the token and returns to the login page', async () => {
    writeToken('tok')
    stubApi(user('member'))
    renderAt('/')
    await screen.findByRole('heading', { name: '总览' })
    await userEvent.setup().click(screen.getByRole('button', { name: '退出' }))
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument()
    expect(readToken()).toBeNull()
  })

  it('an expired token sends the user back to login', async () => {
    writeToken('stale')
    vi.stubGlobal('fetch', async () => Response.json({ error: 'unauthorized' }, { status: 401 }))
    renderAt('/skills')
    expect(await screen.findByRole('button', { name: '登录' })).toBeInTheDocument()
    expect(readToken()).toBeNull()
  })
})
