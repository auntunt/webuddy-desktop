import { afterEach, describe, expect, it } from 'vitest'
import { bootstrapLegacyTokenFromUrl } from './bootstrap-legacy-token'
import { readToken } from './token-store'

function visit(path: string) {
  window.history.replaceState(null, '', path)
}

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('bootstrapLegacyTokenFromUrl', () => {
  it('adopts ?token= into the token store and strips it from the URL', () => {
    visit('/analysis?user=lina&token=old-bookmark-token')
    bootstrapLegacyTokenFromUrl()
    expect(readToken()).toBe('old-bookmark-token')
    expect(window.location.search).toBe('?user=lina')
    expect(window.location.pathname).toBe('/analysis')
  })

  it('preserves the path and hash when there is nothing else in the query', () => {
    visit('/sessions/abc?token=solo#detail')
    bootstrapLegacyTokenFromUrl()
    expect(readToken()).toBe('solo')
    expect(window.location.href).toMatch(/\/sessions\/abc#detail$/)
  })

  it('does nothing when there is no ?token=', () => {
    visit('/skills?user=lina')
    bootstrapLegacyTokenFromUrl()
    expect(readToken()).toBeNull()
    expect(window.location.search).toBe('?user=lina')
  })
})
