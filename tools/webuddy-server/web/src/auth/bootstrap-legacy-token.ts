import { writeToken } from './token-store'

/**
 * Old bookmarks/shared links carried the session token as `?token=`. Adopt it into the
 * normal token store and strip it from the URL before the router ever sees it, so it
 * can't propagate into a filter link or a redirect.
 */
export function bootstrapLegacyTokenFromUrl(): void {
  const url = new URL(window.location.href)
  const token = url.searchParams.get('token')
  if (!token) {
    return
  }
  writeToken(token)
  url.searchParams.delete('token')
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}
