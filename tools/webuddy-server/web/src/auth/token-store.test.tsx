import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client'
import { clearToken, readToken, writeToken } from './token-store'

function throwingStorage(): Storage {
  const fail = () => {
    throw new DOMException('blocked', 'SecurityError')
  }
  return {
    length: 0,
    clear: fail,
    getItem: fail,
    key: fail,
    removeItem: fail,
    setItem: fail
  }
}

describe('token store when localStorage throws', () => {
  afterEach(() => {
    clearToken()
    vi.unstubAllGlobals()
  })

  it('keeps the token in memory so requests stay authenticated', async () => {
    vi.stubGlobal('localStorage', throwingStorage())
    writeToken('mem-token')
    expect(readToken()).toBe('mem-token')

    const fetchMock = vi.fn(async () => Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    await apiFetch('/api/auth/me')
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer mem-token')

    clearToken()
    expect(readToken()).toBeNull()
  })

  it('prefers the stored token when storage works', () => {
    writeToken('stored')
    expect(readToken()).toBe('stored')
    expect(localStorage.getItem('webuddy.token')).toBe('stored')
    clearToken()
    expect(readToken()).toBeNull()
    expect(localStorage.getItem('webuddy.token')).toBeNull()
  })
})
