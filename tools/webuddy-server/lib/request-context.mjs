/** Per-request identity and list-filter derivation, shared across routes. */

import { resolveToken } from './auth.mjs'

/** Resolve the caller's identity from a bearer token, or `?token=` for links. */
export function authenticate(db, req, url) {
  const header = req.headers.authorization ?? ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null
  return resolveToken(db, bearer ?? url.searchParams.get('token'))
}

export function filtersOf(url, auth) {
  const q = url.searchParams
  return {
    // Members are pinned to their own rows; only admins see the whole team.
    ownerId: auth.user.role === 'admin' ? undefined : auth.user.username,
    user: q.get('user') || undefined,
    agent: q.get('agent') || undefined,
    project: q.get('project') || undefined,
    from: q.get('from') || undefined,
    to: q.get('to') || undefined,
    q: q.get('q') || undefined
  }
}
