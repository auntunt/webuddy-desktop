import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch, setUnauthorizedHandler } from './client'
import { readToken, writeToken } from '../auth/token-store'

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('apiFetch', () => {
  beforeEach(() => {
    writeToken('tok-123')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    setUnauthorizedHandler(null)
  })

  it('sends the bearer token, JSON body and query string', async () => {
    const fetchMock = mockFetch(200, { ok: true })
    const data = await apiFetch<{ ok: boolean }>('/api/stats', {
      method: 'POST',
      body: { a: 1 },
      query: { by: 'person', group: '2', empty: '', missing: undefined }
    })
    expect(data).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/stats?by=person&group=2')
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"a":1}')
    const headers = new Headers(init.headers)
    expect(headers.get('authorization')).toBe('Bearer tok-123')
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('on 401 clears the token and hands off to the unauthorized handler', async () => {
    mockFetch(401, { error: 'unauthorized' })
    const onUnauthorized = vi.fn()
    setUnauthorizedHandler(onUnauthorized)
    await expect(apiFetch('/api/auth/me')).rejects.toMatchObject({ status: 401 })
    expect(readToken()).toBeNull()
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })

  it('surfaces the server error message on other failures', async () => {
    mockFetch(403, { error: '只有管理员可以操作' })
    const err = await apiFetch('/api/admin/users').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 403, message: '只有管理员可以操作' })
  })

  it('falls back to the status text when the body has no error field', async () => {
    vi.stubGlobal('fetch', async () => new Response('boom', { status: 500 }))
    await expect(apiFetch('/api/stats')).rejects.toMatchObject({ status: 500, message: 'HTTP 500' })
  })
})

describe('apiFetch without a token', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    setUnauthorizedHandler(null)
  })

  it('treats a 401 as a plain failure (wrong password), not an expired session', async () => {
    mockFetch(401, { error: '用户名或密码不对' })
    const onUnauthorized = vi.fn()
    setUnauthorizedHandler(onUnauthorized)
    await expect(apiFetch('/api/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 401,
      message: '用户名或密码不对'
    })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})
